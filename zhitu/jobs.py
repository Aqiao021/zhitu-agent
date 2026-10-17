"""Job profile database: curated profiles (kb/jobs.json) + real postings imported by the admin."""
import json
import re
import sqlite3
import threading
import time
from pathlib import Path

from .kb import tokens

CATS = ("专业技能", "软件工具", "证书", "项目经验", "通用素养")
LEVELS = ("必需", "加分")


def _clean_req(r: dict) -> dict | None:
    item = str(r.get("item", "")).strip()[:80]
    if not item:
        return None
    kws = [str(k).strip()[:30] for k in (r.get("keywords") or []) if str(k).strip()][:12]
    return {"item": item, "category": r.get("category") if r.get("category") in CATS else "专业技能",
            "level": r.get("level") if r.get("level") in LEVELS else "必需", "keywords": kws}


def normalize(job: dict) -> dict:
    """Shape any job dict (curated or model-extracted) into the canonical form."""
    reqs = [x for x in (_clean_req(r) for r in (job.get("requirements") or []) if isinstance(r, dict)) if x][:14]
    def strs(key, n, m=60):
        return [str(s).strip()[:m] for s in (job.get(key) or []) if str(s).strip()][:n]
    return {
        "id": str(job.get("id", ""))[:60], "title": str(job.get("title", "")).strip()[:40],
        "aliases": strs("aliases", 8, 30), "majors": strs("majors", 6, 20),
        "summary": str(job.get("summary", "")).strip()[:200], "duties": strs("duties", 6, 80),
        "requirements": reqs, "tools": strs("tools", 16, 40), "certificates": strs("certificates", 8, 120),
        "sources": [{"title": str(s.get("title", ""))[:120], "url": str(s.get("url", ""))[:300],
                     "date": str(s.get("date", ""))[:10]} for s in (job.get("sources") or []) if isinstance(s, dict)][:6],
        "kind": job.get("kind") if job.get("kind") in ("画像", "导入") else "画像",
        "city": str(job.get("city", ""))[:20], "education": str(job.get("education", ""))[:20],
    }


def to_jd_text(job: dict) -> str:
    """Readable posting text, used for the knowledge-base lookup and the interview context."""
    lines = [f"岗位：{job['title']}", job.get("summary", "")]
    if job.get("duties"):
        lines.append("工作内容：" + "；".join(job["duties"]))
    lines.append("任职要求：")
    lines += [f"{i + 1}. [{r['level']}] {r['item']}" for i, r in enumerate(job["requirements"])]
    if job.get("tools"):
        lines.append("常用工具：" + "、".join(job["tools"]))
    return "\n".join(x for x in lines if x)


class JobDB:
    def __init__(self, curated: Path, db_path: Path):
        data = json.loads(Path(curated).read_text(encoding="utf-8"))
        self.notice = data.get("notice", "")
        self.updated = data.get("updated", "")
        self.majors_raw = data.get("majors", [])
        self.curated = {j["id"]: normalize(j) for j in data.get("jobs", [])}
        self.db = sqlite3.connect(str(db_path), check_same_thread=False)
        self.lock = threading.Lock()
        with self.lock:
            self.db.executescript("""
            CREATE TABLE IF NOT EXISTS jobs_imported(id TEXT PRIMARY KEY, ts REAL, data TEXT);
            CREATE TABLE IF NOT EXISTS job_submissions(id INTEGER PRIMARY KEY, ts REAL, text TEXT, url TEXT,
                note TEXT, session TEXT);
            """)
            self.db.commit()

    # ------------------------------------------------------------ read
    def all(self) -> dict:
        jobs = dict(self.curated)
        with self.lock:
            for jid, data in self.db.execute("SELECT id, data FROM jobs_imported ORDER BY ts DESC"):
                jobs[jid] = json.loads(data)
        return jobs

    def get(self, jid: str) -> dict | None:
        return self.all().get(str(jid))

    def majors(self) -> list[dict]:
        jobs = self.all()
        out = []
        for m in self.majors_raw:
            ids = [j["id"] for j in jobs.values() if m["name"] in j["majors"]]
            out.append({"name": m["name"], "code": m.get("code", ""), "category": m.get("category", ""),
                        "occupations": m.get("occupations", [])[:8], "sources": m.get("sources", [])[:3],
                        "count": len(ids)})
        return out

    @staticmethod
    def card(j: dict) -> dict:
        must = [r for r in j["requirements"] if r["level"] == "必需"]
        return {"id": j["id"], "title": j["title"], "aliases": j["aliases"][:3], "majors": j["majors"],
                "summary": j["summary"], "tools": j["tools"][:5], "kind": j["kind"], "must": len(must),
                "total": len(j["requirements"]), "city": j.get("city", "")}

    def search(self, q: str = "", major: str = "", limit: int = 40) -> list[dict]:
        q = (q or "").strip()[:60]
        qt = {t for t in tokens(q) if len(t) > 1} or set(tokens(q))  # bigrams / words; unigrams are too loose
        scored = []
        for j in self.all().values():
            if major and major not in j["majors"]:
                continue
            if not q:
                scored.append((0, j))
                continue
            title_blob = " ".join([j["title"], *j["aliases"]]).lower()
            body_blob = " ".join([j["summary"], *j["majors"], *j["tools"],
                                  *[k for r in j["requirements"] for k in r["keywords"]],
                                  *[r["item"] for r in j["requirements"]]]).lower()
            s = 0.0
            if q.lower() in title_blob:
                s += 10 + (3 if any(a.lower().startswith(q.lower()) for a in [j["title"], *j["aliases"]]) else 0)
            elif q.lower() in body_blob:
                s += 4
            tt, bt = set(tokens(title_blob)), set(tokens(body_blob))
            s += 2 * len(qt & tt) + 0.5 * len(qt & bt)
            if s >= max(1.5, 0.5 * len(qt)):
                scored.append((s, j))
        scored.sort(key=lambda x: (-x[0], x[1]["kind"] != "导入", x[1]["title"]))
        return [self.card(j) for _, j in scored[:limit]]

    # ------------------------------------------------------------ write (admin)
    def submit(self, text: str, url: str, note: str, session: str) -> int:
        with self.lock:
            cur = self.db.execute("INSERT INTO job_submissions(ts,text,url,note,session) VALUES(?,?,?,?,?)",
                                  (time.time(), text[:6000], url[:300], note[:100], session[:40]))
            self.db.commit()
            return cur.lastrowid

    def submissions(self) -> list[dict]:
        with self.lock:
            rows = self.db.execute("SELECT id, ts, text, url, note FROM job_submissions ORDER BY id DESC LIMIT 100").fetchall()
        return [{"id": i, "time": time.strftime("%Y-%m-%d %H:%M", time.localtime(ts)), "text": t, "url": u, "note": n}
                for i, ts, t, u, n in rows]

    def take_submission(self, sid: int) -> dict | None:
        with self.lock:
            row = self.db.execute("SELECT text, url FROM job_submissions WHERE id=?", (int(sid),)).fetchone()
        return {"text": row[0], "url": row[1]} if row else None

    def drop_submission(self, sid: int):
        with self.lock:
            self.db.execute("DELETE FROM job_submissions WHERE id=?", (int(sid),))
            self.db.commit()

    def add_imported(self, job: dict) -> dict:
        job = normalize(dict(job, kind="导入"))
        if not job["title"] or len(job["requirements"]) < 3:
            raise ValueError("岗位信息不完整：至少需要岗位名称和 3 条要求")
        base = re.sub(r"[^a-z0-9]+", "", (job["id"] or "").lower())[:20] or "job"
        job["id"] = f"imp_{base}_{int(time.time() * 1000) % 10_000_000}"
        with self.lock:
            self.db.execute("INSERT INTO jobs_imported(id, ts, data) VALUES(?,?,?)",
                            (job["id"], time.time(), json.dumps(job, ensure_ascii=False)))
            self.db.commit()
        return job

    def remove_imported(self, jid: str) -> bool:
        with self.lock:
            n = self.db.execute("DELETE FROM jobs_imported WHERE id=?", (str(jid),)).rowcount
            self.db.commit()
        return bool(n)

    def imported(self) -> list[dict]:
        with self.lock:
            rows = self.db.execute("SELECT data FROM jobs_imported ORDER BY ts DESC").fetchall()
        return [self.card(json.loads(r[0])) for r in rows]
