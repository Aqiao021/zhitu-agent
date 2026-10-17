"""Task logic: prompts → model → JSON → programmatic verification."""
import json
import math
import re
import time

from . import prompts
from .jobs import CATS, JobDB, normalize
from .kb import KnowledgeBase
from .llm import ModelError, extract_json
from .privacy import mask

STATUS = {"具备": 1.0, "部分具备": 0.5, "缺少": 0.0}
WEIGHT = {"必需": 2, "加分": 1}
OLD_CATS = {"工具": "软件工具", "学历证书": "证书", "综合素质": "通用素养"}
MAX_TEXT = 6000
REVIEW_DAYS = (7, 14, 21, 28)
PROJECT_DAYS = (26, 27, 29)
INTERVIEW_DAY = 30


def _norm(s: str) -> str:
    return re.sub(r"\s+", "", s or "")


def _clip(s: str, n: int = MAX_TEXT) -> str:
    s = (s or "").strip()
    return s[:n]


def _refs(chunks) -> str:
    return "\n\n".join(f"[{i + 1}] 《{c.title}》{c.section}（来源：{c.source}）\n{c.text}" for i, c in enumerate(chunks))


def keyword_hits(req: dict, resume: str) -> list[str]:
    low = resume.lower()
    return [k for k in req.get("keywords", []) if k and k.lower() in low][:6]


class Agent:
    def __init__(self, llm, kb: KnowledgeBase, jobs: JobDB | None = None):
        self.llm, self.kb, self.jobs = llm, kb, jobs

    # ---------------------------------------------------------------- diagnose
    def diagnose(self, resume: str, jd: str = "", job_id: str = "") -> dict:
        resume = _clip(resume)
        if len(_norm(resume)) < 30:
            raise ModelError("简历至少 30 字，才能做有意义的对照")
        resume_m, hidden = mask(resume)
        if job_id:
            job = self.jobs.get(job_id) if self.jobs else None
            if not job:
                raise ModelError("岗位库里没有找到这个岗位，请重新选择")
            return self._diagnose_job(job, resume_m, hidden)
        jd = _clip(jd)
        if len(_norm(jd)) < 20:
            raise ModelError("招聘信息至少 20 字；也可以直接从岗位库选择岗位")
        jd_m, _ = mask(jd)
        refs = self.kb.search(jd_m, 3)
        user = f"【招聘信息】\n{jd_m}\n\n【简历】\n{resume_m}\n\n【参考资料】\n{_refs(refs) or '（无）'}"
        data = extract_json(self.llm.chat(prompts.DIAGNOSE, [{"role": "user", "content": user}], 2500))
        out = self.verify_diagnosis(data, resume_m, refs, hidden)
        out["source"] = {"type": "paste"}
        return out

    def _diagnose_job(self, job: dict, resume_m: str, hidden: dict) -> dict:
        reqs = job["requirements"]
        lines = []
        for i, r in enumerate(reqs):
            hits = keyword_hits(r, resume_m)
            lines.append(f"{i + 1}. [{r['level']}·{r['category']}] {r['item']}（简历中出现的相关词：{'、'.join(hits) or '无'}）")
        refs = self.kb.search(job["title"] + " " + " ".join(job["tools"][:5]), 3)
        user = (f"【岗位】{job['title']}：{job['summary']}\n【岗位要求】\n" + "\n".join(lines) +
                f"\n\n【简历】\n{resume_m}\n\n【参考资料】\n{_refs(refs) or '（无）'}")
        data = extract_json(self.llm.chat(prompts.DIAGNOSE_JOB, [{"role": "user", "content": user}], 3000))
        by_n = {}
        for r in data.get("results") or []:
            try:
                by_n[int(r.get("n"))] = r
            except (TypeError, ValueError, AttributeError):
                continue
        merged = []
        for i, r in enumerate(reqs):
            got = by_n.get(i + 1, {})
            merged.append({"item": r["item"], "category": r["category"], "level": r["level"],
                           "status": got.get("status", "缺少"), "evidence": got.get("evidence", ""),
                           "advice": got.get("advice", "") or "先补这一项的基础，再做一个能展示的小练习"})
        data["requirements"] = merged
        data["job_title"] = job["title"]
        out = self.verify_diagnosis(data, resume_m, refs, hidden, fixed=True)
        out["source"] = {"type": "job", "id": job["id"], "kind": job["kind"], "sources": job["sources"][:3]}
        out["job"] = {"id": job["id"], "title": job["title"], "tools": job["tools"],
                      "certificates": job["certificates"]}
        return out

    @staticmethod
    def verify_diagnosis(data: dict, resume_masked: str, refs, hidden: dict, fixed: bool = False) -> dict:
        """Programmatic checks: evidence must be a verbatim quote; score is computed, not guessed."""
        reqs, flagged = [], 0
        norm_resume = _norm(resume_masked)
        for r in (data.get("requirements") or [])[:15]:
            if not isinstance(r, dict) or not str(r.get("item", "")).strip():
                continue
            status = r.get("status") if r.get("status") in STATUS else "缺少"
            evidence = str(r.get("evidence", "")).strip()
            verified = bool(evidence) and _norm(evidence) in norm_resume
            note = ""
            if evidence and not verified:
                flagged += 1
                note = "模型给出的依据在简历中找不到原文，已降级处理"
                evidence = ""
                if status == "具备":
                    status = "部分具备"
            if not evidence and status == "具备":
                status = "部分具备"
                note = note or "简历中没有找到明确依据"
            cat = OLD_CATS.get(r.get("category"), r.get("category"))
            reqs.append({"item": str(r["item"]).strip()[:80], "category": cat if cat in CATS else "专业技能",
                         "level": r.get("level") if r.get("level") in WEIGHT else "必需",
                         "status": status, "evidence": evidence[:200], "verified": verified, "note": note,
                         "advice": str(r.get("advice", "")).strip()[:80]})
        if not reqs:
            raise ModelError("没有从招聘信息里识别出岗位要求，请检查粘贴的内容")
        total_w = sum(WEIGHT[r["level"]] for r in reqs)
        score = round(100 * sum(STATUS[r["status"]] * WEIGHT[r["level"]] for r in reqs) / total_w)
        counts = {k: sum(1 for r in reqs if r["status"] == k) for k in STATUS}
        must_gaps = sum(1 for r in reqs if r["level"] == "必需" and r["status"] == "缺少")
        order = {"缺少": 0, "部分具备": 1, "具备": 2}
        return {
            "job_title": str(data.get("job_title", "目标岗位"))[:40],
            "summary": str(data.get("summary", ""))[:300],
            "match_score": score, "counts": counts, "must_gaps": must_gaps,
            "requirements": sorted(reqs, key=lambda r: (order[r["status"]], r["level"] != "必需")),
            "strengths": [str(s)[:80] for s in (data.get("strengths") or [])][:3],
            "honesty_notes": [str(s)[:120] for s in (data.get("honesty_notes") or [])][:5],
            "standard_note": str(data.get("standard_note", ""))[:200],
            "references": [c.cite() for c in refs],
            "privacy": hidden, "unverified_evidence": flagged,
        }

    # ---------------------------------------------------------------- 30-day plan
    def plan(self, diagnosis: dict, daily_hours: float = 2) -> dict:
        try:
            daily_hours = float(daily_hours)
        except (TypeError, ValueError):
            daily_hours = 2.0
        daily_hours = max(1.0, min(4.0, round(daily_hours * 2) / 2))
        daily = int(daily_hours * 60)
        gaps = [r for r in diagnosis.get("requirements", []) if r.get("status") != "具备"]
        if not gaps:
            raise ModelError("诊断里没有需要补的项，可以直接准备投递和面试")
        rank = {("必需", "缺少"): 0, ("必需", "部分具备"): 1, ("加分", "缺少"): 2, ("加分", "部分具备"): 3}
        gaps.sort(key=lambda g: rank.get((g.get("level", "必需"), g.get("status")), 4))
        job = diagnosis.get("job") or {}
        learn_days = [d for d in range(1, 31) if d not in REVIEW_DAYS + PROJECT_DAYS + (INTERVIEW_DAY,)]
        brief = json.dumps({"job_title": diagnosis.get("job_title"),
                            "job_tools": job.get("tools", [])[:12],
                            "gaps": [{k: g.get(k) for k in ("item", "category", "level", "status", "advice")}
                                     for g in gaps[:10]]}, ensure_ascii=False)
        user = (f"每天可用时间：{daily} 分钟\n学习日共 {len(learn_days)} 天，学习日总时长约 {daily * len(learn_days)} 分钟\n"
                f"差距诊断：{brief}")
        data = extract_json(self.llm.chat(prompts.PLAN30, [{"role": "user", "content": user}], 4000))
        return self.schedule(data, daily, diagnosis, gaps)

    @staticmethod
    def schedule(data: dict, daily: int, diagnosis: dict, gaps: list) -> dict:
        """Deterministic calendar: the model designs modules, the program fits them into 30 days."""
        modules = []
        for m in (data.get("modules") or [])[:10]:
            if not isinstance(m, dict) or not str(m.get("skill", "")).strip():
                continue
            tasks = []
            for t in (m.get("tasks") or [])[:10]:
                if not isinstance(t, dict) or not str(t.get("title", "")).strip():
                    continue
                try:
                    mins = int(float(t.get("minutes", 60)))
                except (TypeError, ValueError):
                    mins = 60
                tasks.append({"title": str(t["title"]).strip()[:90], "minutes": max(20, min(mins, 240)),
                              "output": str(t.get("output", "")).strip()[:90]})
            if tasks:
                modules.append({"skill": str(m["skill"]).strip()[:30], "gap": str(m.get("gap", ""))[:80],
                                "tools": [str(x).strip()[:30] for x in (m.get("tools") or []) if str(x).strip()][:6],
                                "tasks": tasks})
        if not modules:
            raise ModelError("计划生成失败，请重试")

        # queue of task pieces; a task longer than one day is split into parts
        queue = []
        for mi, m in enumerate(modules):
            for t in m["tasks"]:
                parts = max(1, math.ceil(t["minutes"] / daily))
                for p in range(parts):
                    mins = min(daily, t["minutes"] - p * daily) if parts > 1 else t["minutes"]
                    title = t["title"] + (f"（{p + 1}/{parts}）" if parts > 1 else "")
                    queue.append({"title": title, "minutes": max(20, mins), "output": t["output"] if p == parts - 1 else "完成这一部分并记下卡住的地方",
                                  "skill": m["skill"], "tools": m["tools"], "module": mi})

        days, used_modules = [], {}
        fp = data.get("final_project") or {}
        project = {"title": str(fp.get("title", "")).strip()[:40] or f"{diagnosis.get('job_title', '目标岗位')}综合小项目",
                   "desc": str(fp.get("desc", "")).strip()[:160] or "把前面学到的技能串起来，做一个能写进简历的小作品",
                   "output": str(fp.get("output", "")).strip()[:90] or "可演示的作品和一页说明"}
        rotate = 0
        for d in range(1, 31):
            week = (d - 1) // 7 + 1
            if d == INTERVIEW_DAY:
                tasks = [{"title": "根据 30 天的成果更新简历，只写真实做到的内容", "minutes": min(60, daily // 2),
                          "output": "新版简历，每项技能都能对应一个作品或任务", "skill": "求职准备", "tools": []},
                         {"title": "重新做一次差距诊断，并完成一轮模拟面试", "minutes": daily - min(60, daily // 2),
                          "output": "对比第 1 天的匹配度，记下还要继续补的项", "skill": "求职准备", "tools": []}]
                days.append({"day": d, "week": week, "type": "面试", "theme": "更新简历 · 复诊 · 模拟面试", "tasks": tasks})
                continue
            if d in REVIEW_DAYS:
                recent = sorted({x["skill"] for day in days[-6:] for x in day["tasks"] if x["skill"] not in ("复盘", "求职准备", "综合项目")})
                topic = "、".join(recent[:3]) or "本周内容"
                tasks = [{"title": f"复盘本周：整理 {topic} 的笔记和代码/作品", "minutes": daily // 2,
                          "output": "一页复盘：学会了什么、还卡在哪里", "skill": "复盘", "tools": []},
                         {"title": f"不看笔记重做一遍本周最难的练习（{topic}）", "minutes": daily - daily // 2,
                          "output": "能独立完成，或写下具体卡点去问老师同学", "skill": "复盘", "tools": []}]
                days.append({"day": d, "week": week, "type": "复盘", "theme": "复盘与自测", "tasks": tasks})
                continue
            if d in PROJECT_DAYS:
                i = PROJECT_DAYS.index(d)
                titles = [f"综合项目设计：{project['title']}，列出功能和要用的技能",
                          f"综合项目实现：完成{project['title']}的主要部分",
                          f"综合项目收尾：测试、截图，写项目说明（{project['output']}）"]
                tools = sorted({t for m in modules for t in m["tools"]})[:6]
                days.append({"day": d, "week": week, "type": "项目", "theme": "综合项目",
                             "tasks": [{"title": titles[i], "minutes": daily, "output": project["output"] if i == 2 else "完成当天部分并提交到作品文件夹",
                                        "skill": "综合项目", "tools": tools}]})
                continue
            left, tasks = daily, []
            while queue and queue[0]["minutes"] <= left and len(tasks) < 3:
                t = queue.pop(0)
                left -= t["minutes"]
                tasks.append(t)
            if not tasks and queue:  # never leave a learning day empty
                t = queue.pop(0)
                t["minutes"] = daily
                tasks.append(t)
            if not tasks:  # content ran out: practise earlier modules
                m = modules[rotate % len(modules)]
                rotate += 1
                tasks.append({"title": f"巩固练习：{m['skill']}，独立重做一遍前面的练习并加一个新功能", "minutes": daily,
                              "output": "不看笔记完成，并能讲清每一步", "skill": m["skill"], "tools": m["tools"], "module": modules.index(m)})
            for t in tasks:
                used_modules.setdefault(t["skill"], set()).add(d)
            theme = "、".join(dict.fromkeys(t["skill"] for t in tasks))
            days.append({"day": d, "week": week, "type": "学习", "theme": theme, "tasks": tasks})

        for day in days:
            for i, t in enumerate(day["tasks"]):
                t.pop("module", None)
                t["id"] = f"d{day['day']}-{i}"
            day["minutes"] = sum(t["minutes"] for t in day["tasks"])

        skills = [{"skill": m["skill"], "gap": m["gap"], "tools": m["tools"],
                   "days": sorted(used_modules.get(m["skill"], []))} for m in modules]
        tools = list(dict.fromkeys(t for m in modules for t in m["tools"]))
        job = diagnosis.get("job") or {}
        certs = job.get("certificates", [])[:4] if any(g.get("category") == "证书" for g in gaps) else []
        return {"daily_minutes": daily, "days": days, "skills": skills, "tools": tools, "certificates": certs,
                "project": project, "unscheduled": [t["title"] for t in queue][:20],
                "tips": [str(s)[:80] for s in (data.get("tips") or [])][:3],
                "job_title": diagnosis.get("job_title", ""), "created": time.strftime("%Y-%m-%d")}

    # ---------------------------------------------------------------- import a real posting
    def extract_job(self, text: str, url: str = "") -> dict:
        text = _clip(text)
        if len(_norm(text)) < 40:
            raise ModelError("招聘信息太短，至少需要 40 字")
        text_m, _ = mask(text)
        majors = [m["name"] for m in self.jobs.majors_raw] if self.jobs else []
        user = f"可选专业：{'、'.join(majors)}\n\n【招聘信息】\n{text_m}"
        data = extract_json(self.llm.chat(prompts.EXTRACT_JOB, [{"role": "user", "content": user}], 2500))
        data["majors"] = [m for m in (data.get("majors") or []) if m in majors]
        data["sources"] = [{"title": "同学提交的真实招聘信息（已隐去公司与联系方式）", "url": url[:300] if url.startswith("http") else "",
                            "date": time.strftime("%Y-%m")}]
        job = normalize(dict(data, kind="导入"))
        if not job["title"] or len(job["requirements"]) < 3:
            raise ModelError("没能从这条招聘里整理出足够的要求（至少 3 条）")
        return job

    # ---------------------------------------------------------------- interview
    def interview(self, diagnosis: dict, history: list[dict], rounds: int = 5) -> dict:
        rounds = max(3, min(int(rounds or 5), 8))
        history = [{"q": str(h.get("q", ""))[:300], "a": mask(str(h.get("a", "")))[0][:1500]}
                   for h in (history or [])][:rounds]
        ctx = json.dumps({"job_title": diagnosis.get("job_title"),
                          "requirements": [{k: r.get(k) for k in ("item", "status", "evidence")}
                                           for r in diagnosis.get("requirements", [])]}, ensure_ascii=False)
        log = "\n".join(f"第{i + 1}题：{h['q']}\n回答：{h['a'] or '（未作答）'}" for i, h in enumerate(history))
        if len(history) >= rounds:
            data = extract_json(self.llm.chat(prompts.INTERVIEW_END,
                                              [{"role": "user", "content": f"岗位与诊断：{ctx}\n\n问答记录：\n{log}"}], 2000))
            scores = {}
            for k in ("专业知识", "项目表达", "问题解决", "沟通表达", "岗位匹配"):
                try:
                    scores[k] = max(1, min(5, int(round(float((data.get("scores") or {}).get(k, 3))))))
                except (TypeError, ValueError):
                    scores[k] = 3
            better = data.get("better_answer") or {}
            return {"done": True, "scores": scores, "total": round(sum(scores.values()) / 25 * 100),
                    "reasons": {k: str((data.get("reasons") or {}).get(k, ""))[:120] for k in scores},
                    "advice": [str(s)[:100] for s in (data.get("advice") or [])][:3],
                    "better_answer": {"question": str(better.get("question", ""))[:200],
                                      "answer": str(better.get("answer", ""))[:600]}}
        data = extract_json(self.llm.chat(prompts.INTERVIEW_Q,
                                          [{"role": "user", "content": f"岗位与诊断：{ctx}\n\n已进行的问答：\n{log or '（尚未开始）'}\n\n请出第 {len(history) + 1} 题（共 {rounds} 题）。"}], 600, 0.6))
        q = str(data.get("question", "")).strip()
        if not q:
            raise ModelError("没有生成面试问题，请重试")
        return {"done": False, "index": len(history) + 1, "rounds": rounds, "question": q[:300],
                "focus": str(data.get("focus", ""))[:20]}

    # ---------------------------------------------------------------- ask
    def ask(self, question: str) -> dict:
        question = _clip(question, 500)
        if len(_norm(question)) < 2:
            raise ModelError("请输入问题")
        question, _ = mask(question)
        refs = self.kb.search(question, 5)
        if not refs:
            return {"answer": "资料库里没有找到相关信息。建议向学院就业指导老师或辅导员咨询。", "references": [], "grounded": False}
        answer = self.llm.chat(prompts.ASK, [{"role": "user", "content": f"参考资料：\n{_refs(refs)}\n\n问题：{question}"}], 800)
        cited = sorted({int(n) for n in re.findall(r"\[(\d+)\]", answer) if 1 <= int(n) <= len(refs)})
        answer = re.sub(r"\[(\d+)\]", lambda m: m.group(0) if 1 <= int(m.group(1)) <= len(refs) else "", answer)
        return {"answer": answer.strip(), "references": [dict(refs[i - 1].cite(), n=i) for i in cited],
                "grounded": bool(cited)}
