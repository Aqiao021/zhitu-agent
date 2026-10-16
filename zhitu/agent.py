"""Task logic: prompts → model → JSON → programmatic verification."""
import json
import re

from . import prompts
from .kb import KnowledgeBase
from .llm import ModelError, extract_json
from .privacy import mask

STATUS = {"具备": 1.0, "部分具备": 0.5, "缺少": 0.0}
CATS = {"专业技能", "工具", "项目经验", "学历证书", "综合素质"}
MAX_TEXT = 6000


def _norm(s: str) -> str:
    return re.sub(r"\s+", "", s or "")


def _clip(s: str, n: int = MAX_TEXT) -> str:
    s = (s or "").strip()
    return s[:n]


def _refs(chunks) -> str:
    return "\n\n".join(f"[{i + 1}] 《{c.title}》{c.section}（来源：{c.source}）\n{c.text}" for i, c in enumerate(chunks))


class Agent:
    def __init__(self, llm, kb: KnowledgeBase):
        self.llm, self.kb = llm, kb

    # ---------------------------------------------------------------- diagnose
    def diagnose(self, resume: str, jd: str) -> dict:
        resume, jd = _clip(resume), _clip(jd)
        if len(_norm(resume)) < 30 or len(_norm(jd)) < 20:
            raise ModelError("简历至少 30 字、招聘信息至少 20 字，才能做有意义的对照")
        resume_m, hidden = mask(resume)
        jd_m, _ = mask(jd)
        refs = self.kb.search(jd_m, 3)
        user = f"【招聘信息】\n{jd_m}\n\n【简历】\n{resume_m}\n\n【参考资料】\n{_refs(refs) or '（无）'}"
        data = extract_json(self.llm.chat(prompts.DIAGNOSE, [{"role": "user", "content": user}], 2500))
        return self.verify_diagnosis(data, resume_m, refs, hidden)

    @staticmethod
    def verify_diagnosis(data: dict, resume_masked: str, refs, hidden: dict) -> dict:
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
            cat = r.get("category") if r.get("category") in CATS else "专业技能"
            reqs.append({"item": str(r["item"]).strip()[:60], "category": cat, "status": status,
                         "evidence": evidence[:200], "verified": verified, "note": note,
                         "advice": str(r.get("advice", "")).strip()[:80]})
        if not reqs:
            raise ModelError("没有从招聘信息里识别出岗位要求，请检查粘贴的内容")
        score = round(100 * sum(STATUS[r["status"]] for r in reqs) / len(reqs))
        counts = {k: sum(1 for r in reqs if r["status"] == k) for k in STATUS}
        order = {"缺少": 0, "部分具备": 1, "具备": 2}
        return {
            "job_title": str(data.get("job_title", "目标岗位"))[:40],
            "summary": str(data.get("summary", ""))[:300],
            "match_score": score, "counts": counts,
            "requirements": sorted(reqs, key=lambda r: order[r["status"]]),
            "strengths": [str(s)[:80] for s in (data.get("strengths") or [])][:3],
            "honesty_notes": [str(s)[:120] for s in (data.get("honesty_notes") or [])][:5],
            "standard_note": str(data.get("standard_note", ""))[:200],
            "references": [c.cite() for c in refs],
            "privacy": hidden, "unverified_evidence": flagged,
        }

    # ---------------------------------------------------------------- plan
    def plan(self, diagnosis: dict, weekly_hours: int = 10) -> dict:
        weekly_hours = max(3, min(int(weekly_hours or 10), 40))
        gaps = [r for r in diagnosis.get("requirements", []) if r.get("status") != "具备"]
        if not gaps:
            raise ModelError("诊断里没有需要补的项，可以直接准备投递和面试")
        brief = json.dumps({"job_title": diagnosis.get("job_title"),
                            "gaps": [{k: g.get(k) for k in ("item", "category", "status", "advice")} for g in gaps]},
                           ensure_ascii=False)
        user = f"每周可用时间：{weekly_hours} 小时\n差距诊断：{brief}"
        data = extract_json(self.llm.chat(prompts.PLAN, [{"role": "user", "content": user}], 2500))
        weeks = []
        for w in (data.get("weeks") or [])[:4]:
            tasks = []
            for t in (w.get("tasks") or [])[:5]:
                try:
                    hours = max(0.5, min(float(t.get("hours", 1)), 40))
                except (TypeError, ValueError):
                    hours = 1.0
                if str(t.get("task", "")).strip():
                    tasks.append({"task": str(t["task"])[:80], "hours": hours, "check": str(t.get("check", ""))[:80]})
            total = sum(t["hours"] for t in tasks)
            if total > weekly_hours:  # enforce the budget the student gave
                scale = weekly_hours / total
                for t in tasks:
                    t["hours"] = round(max(0.5, t["hours"] * scale), 1)
            weeks.append({"week": len(weeks) + 1, "goal": str(w.get("goal", ""))[:60], "tasks": tasks,
                          "hours": round(sum(t["hours"] for t in tasks), 1)})
        if not weeks:
            raise ModelError("计划生成失败，请重试")
        return {"weekly_hours": weekly_hours, "weeks": weeks, "tips": [str(s)[:80] for s in (data.get("tips") or [])][:3]}

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
