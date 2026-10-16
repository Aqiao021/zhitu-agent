import json
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from zhitu import prompts  # noqa: E402
from zhitu.agent import Agent  # noqa: E402
from zhitu.demo import DemoLLM  # noqa: E402
from zhitu.kb import KnowledgeBase, tokens  # noqa: E402
from zhitu.llm import ModelError, extract_json  # noqa: E402
from zhitu.privacy import mask  # noqa: E402
from zhitu.store import Store  # noqa: E402

KB = KnowledgeBase(ROOT / "kb")
RESUME = "教育：漳州职业技术学院 人工智能技术应用\n技能：会使用 Python 写简单脚本；了解 Git 基本操作\n项目：校园问答小程序，用 Python 调用大模型 API。电话 13800001234"
JD = "AI 应用开发实习生\n任职要求：熟悉 Python；了解 Linux；了解大模型 API 调用；熟悉 Git；良好的沟通能力"


class ScriptedLLM:
    """Returns a fixed reply and records what was sent."""
    def __init__(self, reply):
        self.reply, self.sent = reply, []

    def chat(self, system, messages, max_tokens=2000, temperature=0.3):
        self.sent.append((system, messages))
        return self.reply if isinstance(self.reply, str) else json.dumps(self.reply, ensure_ascii=False)


class PrivacyTest(unittest.TestCase):
    def test_masks_identifiers(self):
        text, n = mask("电话：13800001234，身份证 350602200501011234，邮箱 a.b@qq.com，微信号：lin_2026ab，住址：漳州市芗城区某路1号")
        for leaked in ("13800001234", "350602200501011234", "a.b@qq.com", "lin_2026ab", "某路1号"):
            self.assertNotIn(leaked, text)
        self.assertEqual(set(n), {"手机号", "身份证号", "邮箱", "微信号", "住址"})

    def test_keeps_normal_numbers(self):
        text, n = mask("2026级，组织 30 名同学，项目 v3.3")
        self.assertEqual(n, {})
        self.assertIn("2026级", text)


class JsonTest(unittest.TestCase):
    def test_fenced_and_prose(self):
        self.assertEqual(extract_json('好的：\n```json\n{"a": "x}y", "b": [1]}\n```'), {"a": "x}y", "b": [1]})

    def test_missing(self):
        with self.assertRaises(ModelError):
            extract_json("抱歉我无法完成")


class KbTest(unittest.TestCase):
    def test_tokens(self):
        self.assertIn("申报", tokens("申报条件"))
        self.assertIn("python", tokens("Python开发"))

    def test_search_finds_standard(self):
        hits = KB.search("大专毕业多久可以申报初级", 3)
        self.assertTrue(any("申报条件（初级）" == c.section for c in hits))

    def test_every_doc_has_source(self):
        for d in KB.documents():
            self.assertTrue(d["source"], d["title"])


class DiagnoseTest(unittest.TestCase):
    def test_verifies_evidence_and_computes_score(self):
        llm = ScriptedLLM({"job_title": "AI 应用开发实习生", "summary": "基础不错",
                           "requirements": [
                               {"item": "熟悉 Python", "category": "专业技能", "status": "具备", "evidence": "会使用 Python 写简单脚本", "advice": "a"},
                               {"item": "了解 Linux", "category": "工具", "status": "具备", "evidence": "精通 Linux 运维", "advice": "b"},
                               {"item": "沟通能力", "category": "综合素质", "status": "具备", "evidence": "", "advice": "c"},
                               {"item": "熟悉 Git", "category": "工具", "status": "部分具备", "evidence": "了解 Git 基本操作", "advice": "d"}],
                           "strengths": ["有项目"], "honesty_notes": [], "standard_note": ""})
        d = Agent(llm, KB).diagnose(RESUME, JD)
        by = {r["item"]: r for r in d["requirements"]}
        self.assertEqual(by["熟悉 Python"]["status"], "具备")
        self.assertTrue(by["熟悉 Python"]["verified"])
        self.assertEqual(by["了解 Linux"]["status"], "部分具备")      # fabricated evidence downgraded
        self.assertEqual(by["了解 Linux"]["evidence"], "")
        self.assertEqual(by["沟通能力"]["status"], "部分具备")       # no evidence → cannot be 具备
        self.assertEqual(d["unverified_evidence"], 1)
        self.assertEqual(d["match_score"], round(100 * (1 + .5 + .5 + .5) / 4))
        self.assertEqual(d["requirements"][-1]["status"], "具备")     # gaps sorted first

    def test_phone_never_sent_to_model(self):
        llm = ScriptedLLM({"requirements": [{"item": "x", "status": "缺少"}]})
        d = Agent(llm, KB).diagnose(RESUME, JD)
        self.assertNotIn("13800001234", json.dumps(llm.sent, ensure_ascii=False))
        self.assertEqual(d["privacy"], {"手机号": 1})

    def test_rejects_short_input(self):
        with self.assertRaises(ModelError):
            Agent(ScriptedLLM("{}"), KB).diagnose("短", JD)


class PlanTest(unittest.TestCase):
    def test_budget_enforced(self):
        llm = ScriptedLLM({"weeks": [{"week": 1, "goal": "g", "tasks": [{"task": "t1", "hours": 20, "check": "c"}, {"task": "t2", "hours": 20, "check": "c"}]}]})
        p = Agent(llm, KB).plan({"job_title": "x", "requirements": [{"item": "Linux", "status": "缺少"}]}, 10)
        self.assertLessEqual(p["weeks"][0]["hours"], 10.5)

    def test_nothing_to_plan(self):
        with self.assertRaises(ModelError):
            Agent(ScriptedLLM("{}"), KB).plan({"requirements": [{"item": "a", "status": "具备"}]}, 10)


class InterviewTest(unittest.TestCase):
    def test_flow_and_score_clamped(self):
        agent = Agent(ScriptedLLM({"question": "介绍一个项目", "focus": "项目"}), KB)
        q = agent.interview({"job_title": "x", "requirements": []}, [], 3)
        self.assertFalse(q["done"])
        self.assertEqual(q["index"], 1)
        end = Agent(ScriptedLLM({"scores": {"专业知识": 9, "项目表达": "4"}, "advice": ["a"]}), KB)
        r = end.interview({"requirements": []}, [{"q": "q", "a": "a"}] * 3, 3)
        self.assertTrue(r["done"])
        self.assertEqual(r["scores"]["专业知识"], 5)
        self.assertEqual(r["scores"]["沟通表达"], 3)


class AskTest(unittest.TestCase):
    def test_invalid_citations_removed(self):
        llm = ScriptedLLM("大专毕业工作满 1 年可申报初级 [1]，另见 [9]。")
        r = Agent(llm, KB).ask("大专毕业多久可以申报初级")
        self.assertNotIn("[9]", r["answer"])
        self.assertEqual([c["n"] for c in r["references"]], [1])
        self.assertTrue(r["grounded"])

    def test_demo_runs_all_tasks(self):
        agent = Agent(DemoLLM(), KB)
        d = agent.diagnose(RESUME, JD)
        self.assertGreater(len(d["requirements"]), 0)
        p = agent.plan(d, 8)
        self.assertEqual(len(p["weeks"]), 4)
        self.assertIn("[", agent.ask("学校就业率是多少")["answer"])


class StoreTest(unittest.TestCase):
    def test_model_quota_survives_reopen_and_resets_on_next_utc_day(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "quota.db"
            s = Store(path)
            try:
                self.assertTrue(s.reserve_model_call(10, 2, now=86410))
                self.assertTrue(s.reserve_model_call(10, 2, now=86411))
                self.assertFalse(s.reserve_model_call(10, 2, now=87020))
            finally:
                s.db.close()
            s = Store(path)
            try:
                self.assertFalse(s.reserve_model_call(10, 2, now=87021))
                self.assertTrue(s.reserve_model_call(10, 2, now=172810))
            finally:
                s.db.close()

    def test_model_quota_is_a_sliding_window(self):
        with tempfile.TemporaryDirectory() as tmp:
            s = Store(Path(tmp) / "quota.db")
            try:
                self.assertTrue(s.reserve_model_call(2, 10, now=1000))
                self.assertTrue(s.reserve_model_call(2, 10, now=1100))
                self.assertFalse(s.reserve_model_call(2, 10, now=1201))
                self.assertTrue(s.reserve_model_call(2, 10, now=1601))
            finally:
                s.db.close()

    def test_model_quota_is_atomic_across_connections(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "quota.db"
            stores = [Store(path), Store(path)]
            try:
                with ThreadPoolExecutor(max_workers=8) as pool:
                    accepted = list(pool.map(lambda i: stores[i % 2].reserve_model_call(3, 100, now=1000), range(12)))
                self.assertEqual(sum(accepted), 3)
            finally:
                for s in stores:
                    s.db.close()

    def test_stats_and_csv(self):
        with tempfile.TemporaryDirectory() as tmp:
            s = Store(Path(tmp) / "t.db")
            s.event("diagnose", True, 1200, 70, "u1", False)
            s.event("diagnose", False, 500, None, "u2", False)
            s.event("diagnose", True, 100, 50, "u3", True)  # demo excluded
            s.feedback("diagnose", 4, True, "挺准", "u1")
            st = s.stats()
            self.assertEqual(st["users"], 2)
            self.assertEqual(st["events"]["diagnose"]["count"], 2)
            self.assertEqual(st["feedback"]["diagnose"]["avg_rating"], 4)
            self.assertIn("挺准", s.csv())
            s.db.close()


if __name__ == "__main__":
    unittest.main()
