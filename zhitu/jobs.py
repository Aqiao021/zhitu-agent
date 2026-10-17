"""Job profile database: curated profiles (kb/jobs.json) + real postings imported by the admin."""
import json
import re
import sqlite3
import threading
import time
from pathlib import Path

from .kb import tokens

CATS = ("专业技能", "软件工具", "证书", "项目经验", "通用素养")
MAX_COMBO = 10
# keyword normalisation for counting "the same requirement" across postings
SYNONYMS = {"ps": "photoshop", "pr": "premiere", "premiere pro": "premiere", "ae": "after effects", "ai绘图": "aigc", "u3d": "unity",
            "unity3d": "unity", "电工证": "低压电工", "上岗证": "低压电工", "office": "办公软件", "word": "办公软件", "ppt": "办公软件",
            "wps": "办公软件", "prompt": "提示词", "提示词工程": "提示词", "团队协作": "团队合作", "协作": "团队合作", "沟通协调": "沟通",
            "k8s": "kubernetes", "cad": "autocad", "py": "python"}
STOP_TAGS = {"1+x", "证书", "专业", "项目", "实习", "实训", "经验", "大专", "专科", "应届生", "2026届", "能力", "项目经历", "实习经历", "计算机", "相关专业"}


def mentions(keyword: str, text_lower: str) -> bool:
    """Keyword appears in the resume; short Latin words (PS, AE, UE) must stand alone."""
    k = keyword.strip().lower()
    if len(k) < 2:
        return False
    if re.fullmatch(r"[a-z0-9.+#/-]{1,3}", k):
        return re.search(r"(?<![a-z])" + re.escape(k) + r"(?![a-z])", text_lower) is not None
    return k in text_lower


def tag(k: str) -> str:
    k = k.strip().lower()
    return SYNONYMS.get(k, k)
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
        "kind": job.get("kind") if job.get("kind") in ("画像", "导入", "组合") else "画像",
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
        jid = str(jid)
        if jid.startswith("combo:"):
            return self.combine(jid[6:].split(","))
        return self.all().get(jid)

    def combine(self, ids: list[str]) -> dict | None:
        """Count which requirements recur across several postings (for students who apply widely)."""
        allj = self.all()
        jobs = [allj[i] for i in dict.fromkeys(str(x) for x in ids) if i in allj][:MAX_COMBO]
        if len(jobs) < 2:
            return None
        n = len(jobs)
        tag_reqs: dict[str, list] = {}
        for j in jobs:
            for idx, r in enumerate(j["requirements"]):
                for t in {tag(k) for k in r["keywords"]} - STOP_TAGS:
                    tag_reqs.setdefault(t, []).append((j["id"], idx, r))
        def jobs_of(items):
            return {jid for jid, _, _ in items}
        order = sorted(tag_reqs, key=lambda t: (-len(jobs_of(tag_reqs[t])), -sum(r["level"] == "必需" for _, _, r in tag_reqs[t]), t))
        used, groups = set(), []
        for t in order:
            items = [(jid, idx, r) for jid, idx, r in tag_reqs[t] if (jid, idx) not in used]
            hit = jobs_of(items)
            if len(hit) < 2:
                continue
            first = {}
            for jid, idx, r in items:  # one requirement per posting in each group
                first.setdefault(jid, (idx, r))
            reqs = [r for _, r in first.values()]
            for jid, (idx, _) in first.items():
                used.add((jid, idx))
            must = sum(r["level"] == "必需" for r in reqs)
            rep_r = min(reqs, key=lambda r: (r["level"] != "必需", len(r["item"])))
            cats = [r["category"] for r in reqs]
            groups.append({
                "item": rep_r["item"], "category": max(set(cats), key=cats.count),
                "level": "必需" if must * 2 >= len(reqs) else "加分",
                "keywords": list(dict.fromkeys(k for r in reqs for k in r["keywords"]))[:12],
                "count": len(first), "tag": t,
                "jobs": [allj[jid]["title"] for jid in first],
                "variants": list(dict.fromkeys(r["item"] for r in reqs if r["item"] != rep_r["item"]))[:3],
            })
        groups.sort(key=lambda g: (-g["count"], g["level"] != "必需"))
        top = groups[:12]
        tools: dict[str, set] = {}
        for j in jobs:
            for x in j["tools"]:
                tools.setdefault(x, set()).add(j["id"])
        tool_rank = sorted(tools, key=lambda x: -len(tools[x]))
        titles = [j["title"] for j in jobs]
        return {
            "id": "combo:" + ",".join(sorted(j["id"] for j in jobs)), "title": f"海投组合（{n} 个岗位）",
            "aliases": [], "majors": list(dict.fromkeys(m for j in jobs for m in j["majors"]))[:6],
            "summary": "共同要求由程序统计：" + "、".join(titles), "duties": [],
            "requirements": top, "tools": tool_rank[:10],
            "tool_counts": [{"name": x, "count": len(tools[x])} for x in tool_rank[:16]],
            "certificates": list(dict.fromkeys(c for j in jobs for c in j["certificates"]))[:6],
            "sources": [s for j in jobs for s in j["sources"][:1]][:6], "kind": "组合", "city": "", "education": "",
            "combo": {"n": n, "jobs": [{"id": j["id"], "title": j["title"]} for j in jobs],
                      "shared": sum(1 for g in groups if g["count"] == n), "groups": len(groups)},
        }

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

    def search(self, q: str = "", major: str = "", limit: int = 80) -> list[dict]:
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

    def recommend(self, resume: str, limit: int = 8) -> list[dict]:
        """Rank postings by how many of their requirements the resume already mentions (keyword match, no model)."""
        low = resume.lower()
        out = []
        for j in self.all().values():
            tw = hw = 0
            hits, missing = [], []
            for r in j["requirements"]:
                w = 2 if r["level"] == "必需" else 1
                tw += w
                found = [k for k in r["keywords"] if mentions(k, low)]
                if found:
                    hw += w
                    hits.extend(found[:2])
                elif r["level"] == "必需":
                    missing.append(r["item"])
            if not tw:
                continue
            score = round(100 * hw / tw)
            major = next((m for m in j["majors"] if m in resume), "")
            out.append({**self.card(j), "score": score, "major_hit": major,
                        "hits": list(dict.fromkeys(hits))[:8], "missing": missing[:3]})
        out.sort(key=lambda x: (-(x["score"] + (8 if x["major_hit"] else 0)), x["title"]))
        return out[:limit]

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
