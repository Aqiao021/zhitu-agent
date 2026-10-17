"""Offline demo model used when no API key is configured (and in tests).

It applies simple keyword rules so the whole interface can be tried without a model.
Results are clearly marked as demo output in the UI.
"""
import json
import re

from . import prompts

KEYWORDS = ["Python", "Java", "Kotlin", "C++", "JavaScript", "SQL", "MySQL", "Linux", "Git", "Docker",
            "大模型", "API", "RAG", "Agent", "智能体", "深度学习", "机器学习", "PyTorch", "数据处理", "测试",
            "沟通", "团队", "文档", "前端", "Vue", "React", "安卓", "Android", "项目", "本科", "大专", "证书"]


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"[\n。；;！!]", text) if s.strip()]


class DemoLLM:
    def chat(self, system: str, messages: list[dict], max_tokens: int = 2000, temperature: float = 0.3) -> str:
        user = messages[-1]["content"]
        if system == prompts.DIAGNOSE:
            return json.dumps(self._diagnose(user), ensure_ascii=False)
        if system == prompts.DIAGNOSE_JOB:
            return json.dumps(self._diagnose_job(user), ensure_ascii=False)
        if system == prompts.PLAN30:
            return json.dumps(self._plan30(user), ensure_ascii=False)
        if system == prompts.EXTRACT_JOB:
            return json.dumps(self._extract(user), ensure_ascii=False)
        if system == prompts.INTERVIEW_Q:
            n = int(re.search(r"请出第 (\d+) 题", user).group(1))
            qs = ["请用两分钟介绍一个你最有代表性的项目，你具体负责了哪部分？",
                  "这个项目里遇到的最难的问题是什么？你是怎么定位和解决的？",
                  "如果让你独立实现岗位要求里你还不熟悉的那项技能，你会怎么学、多久能上手？",
                  "你如何确认自己做出来的功能是可靠的？用过哪些测试方法？",
                  "团队里和别人意见不一致时，你通常怎么处理？举个真实的例子。",
                  "你为什么想做这个岗位？三年后希望达到什么水平？"]
            return json.dumps({"question": qs[(n - 1) % len(qs)], "focus": "项目与能力"}, ensure_ascii=False)
        if system == prompts.INTERVIEW_END:
            return json.dumps({"scores": {"专业知识": 3, "项目表达": 4, "问题解决": 3, "沟通表达": 4, "岗位匹配": 3},
                               "reasons": {k: "（演示模式）根据回答长度和关键词粗略给分" for k in ["专业知识", "项目表达", "问题解决", "沟通表达", "岗位匹配"]},
                               "advice": ["用“情境-任务-行动-结果”讲项目，突出自己做的部分", "准备 1 个能现场讲清原理的技术点",
                                          "说清楚怎么验证结果，最好有数字"],
                               "better_answer": {"question": "请介绍一个代表性项目", "answer": "（演示模式）接入真实模型后，这里会基于你的回答给出改写示范。"}},
                              ensure_ascii=False)
        if system == prompts.ASK:
            body = user.split("参考资料：\n", 1)[-1].split("\n\n问题：")[0]
            m = re.match(r"\[(\d+)\] 《([^》]+)》(.*?)（来源：[^\n]*）\n(.+)", body.split("\n\n[")[0], re.S)
            if not m:
                return "资料库里没有找到相关信息。"
            n, title, sec, text = m.groups()
            return f"（演示模式，直接摘录最相关的资料）根据《{title}》{sec}：{text.strip()[:180]} [{n}]"
        return "{}"

    def _diagnose(self, user: str) -> dict:
        jd = user.split("【简历】")[0]
        resume = user.split("【简历】")[1].split("【参考资料】")[0]
        found = [k for k in KEYWORDS if k.lower() in jd.lower()][:10] or ["岗位专业技能", "项目经验", "沟通协作"]
        reqs = []
        for k in found:
            ev = next((s for s in _sentences(resume) if k.lower() in s.lower()), "")
            status = "具备" if ev and len(ev) > 12 else "部分具备" if ev else "缺少"
            reqs.append({"item": f"掌握或具备：{k}", "category": "专业技能", "level": "必需", "status": status, "evidence": ev,
                         "advice": f"围绕 {k} 做一个可演示的小练习并写清过程"})
        return {"job_title": "（演示）目标岗位", "summary": "这是演示模式的规则诊断，配置模型 API 后会给出更准确的分析。",
                "requirements": reqs, "strengths": ["已有可以讲述的项目经历"], "honesty_notes": [], "standard_note": ""}

    def _diagnose_job(self, user: str) -> dict:
        resume = user.split("【简历】\n", 1)[1].split("\n\n【参考资料】")[0]
        sents = _sentences(resume)
        results = []
        for m in re.finditer(r"^(\d+)\. \[[^\]]+\] (.+?)（简历中出现的相关词：(.*?)）$", user, re.M):
            n, item, hits = int(m.group(1)), m.group(2), [h for h in m.group(3).split("、") if h and h != "无"]
            ev = next((s for s in sents if any(h.lower() in s.lower() for h in hits)), "") if hits else ""
            status = "具备" if ev and len(hits) >= 2 else "部分具备" if ev else "缺少"
            results.append({"n": n, "status": status, "evidence": ev,
                            "advice": "（演示）把这项写进简历时附上作品或数据" if status == "具备" else f"（演示）围绕“{item[:16]}”做一个可展示的小练习"})
        return {"summary": "这是演示模式的关键词规则诊断，接入真实模型后会逐条理解简历含义。", "results": results,
                "strengths": ["已有可以讲述的经历"], "honesty_notes": [], "standard_note": ""}

    def _plan30(self, user: str) -> dict:
        info = json.loads(user.split("差距诊断：", 1)[1])
        tools = info.get("job_tools") or []
        modules = []
        for i, g in enumerate(info.get("gaps", [])[:6]):
            item = g["item"]
            t = [x for x in tools if x.lower() in item.lower()]
            name = t[0] if t else re.split(r"[，,（(]", item)[0][:14]
            modules.append({"skill": name, "gap": item, "tools": t, "tasks": [
                {"title": f"了解“{item[:20]}”要做到什么程度，找一份官方文档或学校课程", "minutes": 40, "output": "列出 5 个要掌握的知识点"},
                {"title": f"安装并跑通 {name} 的入门示例", "minutes": 60, "output": "截图记录运行结果"},
                {"title": f"跟着教程完成 {name} 的基础练习", "minutes": 90, "output": "完成 3 个练习并保存"},
                {"title": f"用 {name} 独立完成一个小任务", "minutes": 120, "output": "可演示的小作品"},
                {"title": f"用自己的话讲清 {name} 的原理和用法", "minutes": 40, "output": "一页笔记或 2 分钟讲解录音"}]})
        return {"modules": modules,
                "final_project": {"title": f"{info.get('job_title') or '目标岗位'}实战小项目", "desc": "（演示）把前面的技能串成一个完整作品",
                                  "output": "作品、截图和一页项目说明"},
                "tips": ["每天固定时间段学习", "每周找同学互相检查一次"]}

    def _extract(self, user: str) -> dict:
        text = user.split("【招聘信息】\n", 1)[-1]
        lines = [l.strip(" -•·\t") for l in text.splitlines() if l.strip()]
        title = re.sub(r"^(岗位|职位)[:：]?", "", lines[0])[:30] if lines else "导入岗位"
        reqs = []
        for l in lines[1:]:
            l2 = re.sub(r"^\d+[.、．)]\s*", "", l)
            if len(l2) < 6:
                continue
            kws = [k for k in KEYWORDS if k.lower() in l2.lower()][:4] or [l2[:4]]
            reqs.append({"item": l2[:60], "category": "专业技能", "level": "加分" if re.search("优先|加分|了解", l2) else "必需", "keywords": kws})
        return {"title": title, "aliases": [], "majors": [], "summary": "（演示）由规则从招聘原文整理", "duties": [],
                "requirements": reqs[:12], "tools": [k for k in KEYWORDS if k.lower() in text.lower()][:8],
                "certificates": [], "city": "", "education": "大专" if "大专" in text else ""}
