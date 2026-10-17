import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from zhitu import prompts  # noqa: E402
from zhitu.agent import Agent  # noqa: E402
from zhitu.demo import DemoLLM  # noqa: E402
from zhitu.jobs import JobDB, normalize  # noqa: E402
from zhitu.kb import KnowledgeBase, tokens  # noqa: E402
from zhitu.llm import ModelError, extract_json  # noqa: E402
from zhitu.privacy import mask  # noqa: E402
from zhitu.store import Store  # noqa: E402
from zhitu.config import Config  # noqa: E402
from zhitu.userkey import user_config  # noqa: E402

KB = KnowledgeBase(ROOT / "kb")
JOBS = JobDB(ROOT / "kb" / "jobs.json", ":memory:")
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


def modules(n_tasks=6, minutes=60, n_mod=3):
    return {"modules": [{"skill": f"技能{m}", "gap": f"差距{m}", "tools": [f"工具{m}"],
                         "tasks": [{"title": f"任务{m}-{i}", "minutes": minutes, "output": "交付"} for i in range(n_tasks)]}
                        for m in range(n_mod)], "final_project": {"title": "小项目", "desc": "d", "output": "o"}}


GAPS = {"job_title": "x", "requirements": [{"item": "Linux", "status": "缺少", "level": "必需", "category": "专业技能"},
                                          {"item": "证书", "status": "缺少", "level": "加分", "category": "证书"}],
        "job": {"tools": ["Linux"], "certificates": ["某证书"]}}


class PlanTest(unittest.TestCase):
    def test_thirty_days_within_budget(self):
        for hours in (1, 2, 3.5, 4):
            p = Agent(ScriptedLLM(modules()), KB).plan(GAPS, hours)
            self.assertEqual([d["day"] for d in p["days"]], list(range(1, 31)))
            for d in p["days"]:
                self.assertLessEqual(d["minutes"], hours * 60, (hours, d))
                self.assertTrue(d["tasks"])
            types = {d["day"]: d["type"] for d in p["days"]}
            self.assertEqual([k for k, v in types.items() if v == "复盘"], [7, 14, 21, 28])
            self.assertEqual([k for k, v in types.items() if v == "项目"], [26, 27, 29])
            self.assertEqual(types[30], "面试")
            ids = [t["id"] for d in p["days"] for t in d["tasks"]]
            self.assertEqual(len(ids), len(set(ids)))

    def test_long_task_split_and_overflow_reported(self):
        p = Agent(ScriptedLLM(modules(n_tasks=2, minutes=200, n_mod=1)), KB).plan(GAPS, 1)
        titles = [t["title"] for d in p["days"] for t in d["tasks"]]
        self.assertIn("任务0-0（1/4）", titles)
        many = Agent(ScriptedLLM(modules(n_tasks=10, minutes=60, n_mod=5)), KB).plan(GAPS, 1)
        self.assertGreater(len(many["unscheduled"]), 0)

    def test_fills_free_days_with_practice(self):
        p = Agent(ScriptedLLM(modules(n_tasks=1, minutes=30, n_mod=1)), KB).plan(GAPS, 2)
        self.assertTrue(any("巩固练习" in t["title"] for d in p["days"] for t in d["tasks"]))
        self.assertEqual(p["certificates"], ["某证书"])  # a certificate gap exists
        self.assertEqual(p["skills"][0]["tools"], ["工具0"])

    def test_bad_model_output(self):
        with self.assertRaises(ModelError):
            Agent(ScriptedLLM({"modules": []}), KB).plan(GAPS, 2)

    def test_nothing_to_plan(self):
        with self.assertRaises(ModelError):
            Agent(ScriptedLLM("{}"), KB).plan({"requirements": [{"item": "a", "status": "具备"}]}, 2)


class JobDBTest(unittest.TestCase):
    def test_every_job_is_sourced_and_complete(self):
        jobs = JOBS.all()
        self.assertGreaterEqual(len(jobs), 30)
        for j in jobs.values():
            self.assertTrue(j["sources"] and all(s["url"].startswith("http") for s in j["sources"]), j["id"])
            self.assertGreaterEqual(len(j["requirements"]), 8, j["id"])
            self.assertTrue(any(r["level"] == "必需" for r in j["requirements"]))
            self.assertTrue(j["majors"])
        names = {m["name"] for m in JOBS.majors()}
        self.assertIn("人工智能技术应用", names)
        self.assertTrue(all(m["count"] >= 3 for m in JOBS.majors()))

    def test_search(self):
        self.assertEqual(JOBS.search("会计")[0]["title"].startswith("会计"), True)
        self.assertTrue(all("软件技术" in c["majors"] for c in JOBS.search("", "软件技术")))
        self.assertIn("ai_trainer_annotator", [c["id"] for c in JOBS.search("数据标注")])
        self.assertEqual(JOBS.search("完全不存在的岗位xyz"), [])

    def test_import_lifecycle(self):
        db = JobDB(ROOT / "kb" / "jobs.json", ":memory:")
        sid = db.submit("岗位：测试 [已隐藏手机号]", "", "备注", "s")
        self.assertEqual(db.submissions()[0]["id"], sid)
        with self.assertRaises(ValueError):
            db.add_imported({"title": "x", "requirements": [{"item": "a"}]})
        job = db.add_imported({"title": "测试专员", "majors": ["软件技术"], "requirements": [{"item": f"要求{i}"} for i in range(4)]})
        self.assertEqual(job["kind"], "导入")
        self.assertIn(job["id"], [c["id"] for c in db.search("测试专员")])
        self.assertTrue(db.remove_imported(job["id"]))
        self.assertIsNone(db.get(job["id"]))


class RecommendTipsTest(unittest.TestCase):
    def test_keyword_mentions(self):
        from zhitu.jobs import mentions
        self.assertTrue(mentions("PS", "会用 ps 修图"))
        self.assertFalse(mentions("PS", "熟悉 https 协议"))  # short words must stand alone
        self.assertTrue(mentions("Python", "熟悉python"))
        self.assertFalse(mentions("C", "会用 c 语言"))  # one-letter keywords are ignored

    def test_recommend_ranks_relevant_jobs(self):
        agent = Agent(DemoLLM(), KB, JOBS)
        r = agent.recommend("大数据与会计专业，考过初级会计，会用用友U8和金蝶做账，熟练 Excel 数据透视表和 VLOOKUP，在代账公司实习，负责开票和报税。电话 13800001234")
        self.assertEqual(r["results"][0]["id"], "accounting_assistant")
        self.assertEqual(r["privacy"].get("手机号"), 1)
        self.assertTrue(all(0 <= x["score"] <= 100 for x in r["results"]))
        with self.assertRaises(ModelError):
            agent.recommend("太短")

    def test_resume_tips_cannot_invent(self):
        resume = "人工智能技术应用专业。用 LabelImg 标注过图片。会用 Excel 统计数据。参加学院 AI 训练营。"
        reply = {"rewrites": [
            {"original": "用 LabelImg 标注过图片", "rewrite": "使用 LabelImg 完成 3000 张图片的矩形框标注", "requirement": "图像标注"},
            {"original": "在字节跳动实习半年", "rewrite": "在字节跳动负责数据标注", "requirement": "实习"},
            {"original": "会用 Excel 统计数据", "rewrite": "用 Excel 数据透视表统计数据", "requirement": "Excel"}],
            "questions": ["标注了多少张？"]}
        t = Agent(ScriptedLLM(reply), KB, JOBS).resume_tips(resume, {"job_title": "x", "requirements": [{"item": "a", "status": "具备"}]})
        self.assertEqual(t["dropped"], 1)  # "original" not in the resume
        self.assertEqual(len(t["rewrites"]), 2)
        self.assertNotIn("3000", t["rewrites"][0]["rewrite"])  # invented number becomes a blank
        self.assertIn("（填写真实数字）", t["rewrites"][0]["rewrite"])
        self.assertTrue(t["rewrites"][0]["blanks"])
        with self.assertRaises(ModelError):
            Agent(ScriptedLLM(reply), KB, JOBS).resume_tips(resume, {})


class ComboTest(unittest.TestCase):
    def test_common_requirements_counted(self):
        ids = ["ai_app_dev_assistant", "llm_agent_app_developer_junior", "data_analyst_assistant", "ai_trainer_annotator"]
        c = JOBS.combine(ids)
        self.assertEqual(c["combo"]["n"], 4)
        self.assertEqual(c["id"], "combo:" + ",".join(sorted(ids)))
        top = c["requirements"][0]
        self.assertEqual(top["count"], 4)  # every posting asks for Python
        self.assertEqual(top["tag"], "python")
        counts = [r["count"] for r in c["requirements"]]
        self.assertEqual(counts, sorted(counts, reverse=True))
        self.assertTrue(all(r["count"] >= 2 for r in c["requirements"]))
        self.assertEqual(JOBS.get(c["id"])["combo"]["n"], 4)
        self.assertIsNone(JOBS.combine(["ai_app_dev_assistant"]))
        self.assertIsNone(JOBS.combine(["nope", "nope2"]))

    def test_combo_diagnosis_carries_counts(self):
        c = JOBS.combine(["ecommerce_operator", "live_stream_operator", "new_media_operator"])
        llm = ScriptedLLM({"summary": "s", "results": [{"n": 1, "status": "缺少", "evidence": ""}]})
        d = Agent(llm, KB, JOBS).diagnose(RESUME, job_id=c["id"])
        self.assertEqual(d["source"]["combo"]["n"], 3)
        self.assertTrue(all(isinstance(r["count"], int) for r in d["requirements"]))
        self.assertIn("/3个岗位要求", llm.sent[0][1][0]["content"])


class JobDiagnoseTest(unittest.TestCase):
    def test_requirements_fixed_and_weighted(self):
        job = JOBS.get("ai_trainer_annotator")
        n = len(job["requirements"])
        reply = {"summary": "s", "results": [{"n": 1, "status": "具备", "evidence": "用 LabelImg 标注过 500 张图片"},
                                             {"n": 2, "status": "具备", "evidence": "编造的经历"},
                                             {"n": 99, "status": "具备", "evidence": "x"}]}
        llm = ScriptedLLM(reply)
        resume = "人工智能技术应用专业。用 LabelImg 标注过 500 张图片。会用 Excel。电话 13800001234"
        d = Agent(llm, KB, JOBS).diagnose(resume, job_id="ai_trainer_annotator")
        self.assertEqual(len(d["requirements"]), n)  # nothing added or dropped
        self.assertEqual({r["item"] for r in d["requirements"]}, {r["item"] for r in job["requirements"]})
        self.assertEqual(d["unverified_evidence"], 1)
        self.assertEqual(d["source"]["id"], "ai_trainer_annotator")
        w = {"必需": 2, "加分": 1}
        expect = round(100 * sum((1 if r["status"] == "具备" else .5 if r["status"] == "部分具备" else 0) * w[r["level"]] for r in d["requirements"])
                       / sum(w[r["level"]] for r in d["requirements"]))
        self.assertEqual(d["match_score"], expect)
        sent = llm.sent[0][1][0]["content"]
        self.assertNotIn("13800001234", sent)
        self.assertIn("简历中出现的相关词：LabelImg", sent)

    def test_unknown_job(self):
        with self.assertRaises(ModelError):
            Agent(ScriptedLLM("{}"), KB, JOBS).diagnose(RESUME, job_id="nope")

    def test_extract_job(self):
        reply = {"title": "数据标注员", "majors": ["人工智能技术应用", "不存在的专业"], "summary": "标注",
                 "requirements": [{"item": f"要求{i}", "category": "乱写", "level": "必需", "keywords": ["k"]} for i in range(5)]}
        llm = ScriptedLLM(reply)
        job = Agent(llm, KB, JOBS).extract_job("招聘数据标注员，要求细心，联系电话 13800001234，" * 3, "https://example.com/j")
        self.assertEqual(job["majors"], ["人工智能技术应用"])
        self.assertEqual(job["requirements"][0]["category"], "专业技能")
        self.assertEqual(job["kind"], "导入")
        self.assertNotIn("13800001234", llm.sent[0][1][0]["content"])


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
        agent = Agent(DemoLLM(), KB, JOBS)
        d = agent.diagnose(RESUME, JD)
        self.assertGreater(len(d["requirements"]), 0)
        p = agent.plan(d, 2)
        self.assertEqual(len(p["days"]), 30)
        dj = agent.diagnose(RESUME, job_id="ai_app_dev_assistant")
        self.assertEqual(len(dj["requirements"]), len(JOBS.get("ai_app_dev_assistant")["requirements"]))
        self.assertEqual(len(agent.plan(dj, 3)["days"]), 30)
        self.assertTrue(agent.extract_job("岗位：数据标注员\n1. 熟悉 Python\n2. 会用 Excel 整理数据\n3. 有项目经验优先\n4. 沟通能力好，能接受加班")["requirements"])
        self.assertIn("[", agent.ask("学校就业率是多少")["answer"])


class UserKeyTest(unittest.TestCase):
    def test_builds_per_request_config(self):
        base = Config(api_key="server-key")
        c = user_config(base, {"provider": "deepseek", "api_key": "synthetic-test-credential", "model": "deepseek-flash",
                               "base_url": "http://169.254.169.254/"}, [])
        self.assertEqual(c.base_url, "https://api.deepseek.com")  # request cannot choose the address
        self.assertEqual(c.api_key, "synthetic-test-credential")
        self.assertEqual(base.api_key, "server-key")  # server config untouched
        self.assertIsNone(user_config(base, None, []))
        self.assertIsNone(user_config(base, {"provider": "deepseek"}, []))

    def test_rejects_bad_input(self):
        base = Config()
        for bad in ({"provider": "evil", "api_key": "synthetic-test-credential"},
                    {"provider": "deepseek", "api_key": "短"},
                    {"provider": "deepseek", "api_key": "synthetic 中文 credential"},
                    {"provider": "ark", "api_key": "synthetic-test-credential", "model": ""},
                    {"provider": "deepseek", "api_key": "synthetic-test-credential", "model": "a b"}):
            with self.assertRaises(ModelError):
                user_config(base, bad, [])
        with self.assertRaises(ModelError):
            user_config(Config(allow_user_key=False), {"provider": "deepseek", "api_key": "synthetic-test-credential"}, [])


class StoreTest(unittest.TestCase):
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
