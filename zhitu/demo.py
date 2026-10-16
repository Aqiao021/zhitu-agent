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
        if system == prompts.PLAN:
            return json.dumps(self._plan(user), ensure_ascii=False)
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
            reqs.append({"item": f"掌握或具备：{k}", "category": "专业技能", "status": status, "evidence": ev,
                         "advice": f"围绕 {k} 做一个可演示的小练习并写清过程"})
        return {"job_title": "（演示）目标岗位", "summary": "这是演示模式的规则诊断，配置模型 API 后会给出更准确的分析。",
                "requirements": reqs, "strengths": ["已有可以讲述的项目经历"], "honesty_notes": [], "standard_note": ""}

    def _plan(self, user: str) -> dict:
        hours = int(re.search(r"每周可用时间：(\d+)", user).group(1))
        gaps = json.loads(user.split("差距诊断：", 1)[1]).get("gaps", [])
        weeks = []
        for w in range(4):
            g = gaps[w % len(gaps)]["item"] if gaps else "岗位技能"
            weeks.append({"week": w + 1, "goal": f"补齐：{g}", "tasks": [
                {"task": f"学习 {g} 的基础知识并做笔记", "hours": hours * 0.4, "check": "能用自己的话讲清 3 个要点"},
                {"task": f"完成一个与 {g} 相关的小练习", "hours": hours * 0.5, "check": "提交可运行的代码或作品"},
                {"task": "复盘本周进度", "hours": hours * 0.1, "check": "写下完成情况和问题"}]})
        return {"weekly_hours": hours, "weeks": weeks, "tips": ["每天固定时间段学习", "每周找同学互相检查一次"]}
