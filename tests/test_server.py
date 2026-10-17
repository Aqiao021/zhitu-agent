import contextlib
import io
import socket
import time
from unittest.mock import patch
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ["ZHITU_DATA_DIR"] = tempfile.mkdtemp()
os.environ.pop("ZHITU_API_KEY", None)
import server  # noqa: E402


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()

    def get(self, path):
        with urllib.request.urlopen(self.base + path, timeout=5) as r:
            return r.status, r.headers, r.read().decode("utf-8")

    def post(self, path, body):
        req = urllib.request.Request(self.base + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_pages_and_headers(self):
        for p in ("/", "/stats", "/app.js", "/styles.css", "/favicon.svg", "/stats.js"):
            status, headers, _ = self.get(p)
            self.assertEqual(status, 200, p)
        _, headers, html = self.get("/")
        self.assertIn("script-src 'self'", headers["Content-Security-Policy"])
        self.assertNotIn("onclick=", html)

    def test_no_path_traversal(self):
        with self.assertRaises(urllib.error.HTTPError):
            self.get("/../server.py")

    def test_demo_diagnose_roundtrip(self):
        status, d = self.post("/api/diagnose", {"resume": "技能：会使用 Python 写简单脚本，了解 Git 基本操作，做过校园问答小程序项目",
                                                "jd": "任职要求：熟悉 Python 和 Git，了解 Linux"})
        self.assertEqual(status, 200)
        self.assertTrue(d["demo"])
        self.assertIn("match_score", d)

    def test_bad_input(self):
        status, d = self.post("/api/diagnose", {"resume": "短", "jd": "短"})
        self.assertEqual(status, 502)
        self.assertIn("至少", d["error"])

    def test_job_library_api(self):
        _, _, body = self.get("/api/majors")
        d = json.loads(body)
        self.assertGreaterEqual(len(d["majors"]), 14)
        _, _, body = self.get("/api/jobs?q=" + urllib.parse.quote("会计"))
        self.assertTrue(json.loads(body)["results"])
        _, _, body = self.get("/api/jobs/ai_trainer_annotator")
        self.assertEqual(json.loads(body)["id"], "ai_trainer_annotator")
        with self.assertRaises(urllib.error.HTTPError):
            self.get("/api/jobs/nope")

    def test_combo_routes(self):
        status, _, body = self.get("/api/jobs/common?ids=ui_designer_junior,ecommerce_visual_designer,video_editor")
        c = json.loads(body)
        self.assertEqual(c["combo"]["n"], 3)
        _, _, body = self.get("/api/jobs/" + urllib.parse.quote(c["id"]))
        self.assertEqual(json.loads(body)["kind"], "组合")

    def test_job_diagnose_and_plan(self):
        status, d = self.post("/api/diagnose", {"resume": "技能：会使用 Python 和 Pandas 做数据清洗，用 LabelImg 标注过图片，会用 Excel",
                                                "job_id": "ai_trainer_annotator"})
        self.assertEqual(status, 200)
        self.assertEqual(d["source"]["type"], "job")
        status, p = self.post("/api/plan", {"diagnosis": d, "daily_hours": 1.5})
        self.assertEqual(status, 200)
        self.assertEqual(len(p["days"]), 30)
        self.assertTrue(all(day["minutes"] <= 90 for day in p["days"]))

    def test_submit_and_admin(self):
        text = "岗位：仓储专员\n1. 熟悉出入库流程\n2. 会用 Excel 和 WMS\n3. 有叉车证优先\n4. 能吃苦耐劳 联系电话 13800001234"
        status, _ = self.post("/api/jobs/submit", {"text": text})
        self.assertEqual(status, 200)
        _, _, body = self.get("/api/admin/jobs")  # local requests count as admin
        subs = json.loads(body)["submissions"]
        self.assertNotIn("13800001234", subs[0]["text"])
        status, ex = self.post("/api/admin/extract", {"submission_id": subs[0]["id"]})
        self.assertEqual(status, 200)
        status, saved = self.post("/api/admin/save", {"job": ex["job"], "submission_id": subs[0]["id"]})
        self.assertEqual(status, 200)
        _, _, body = self.get("/api/jobs/" + saved["job"]["id"])
        self.assertEqual(json.loads(body)["kind"], "导入")
        self.assertTrue(self.post("/api/admin/delete_job", {"id": saved["job"]["id"]})[1]["ok"])

    def test_admin_needs_token_behind_proxy(self):
        req = urllib.request.Request(self.base + "/api/admin/jobs", headers={"X-Forwarded-For": "1.2.3.4"})
        with self.assertRaises(urllib.error.HTTPError) as cm:
            urllib.request.urlopen(req, timeout=5)
        self.assertEqual(cm.exception.code, 403)

    def test_user_key_routes_to_own_model(self):
        seen = []

        class FakeLLM:
            def __init__(self, cfg):
                seen.append(cfg)

            def chat(self, system, messages, max_tokens=2000, temperature=0.3):
                return "OK" if "连接测试" in system else json.dumps({"summary": "s", "results": [], "strengths": []})

        old = server.LLM
        server.LLM = FakeLLM
        try:
            k = {"provider": "zhipu", "api_key": "synthetic-test-credential", "model": "glm-4-flash"}
            status, r = self.post("/api/key/test", {"llm": k})
            self.assertEqual((status, r["model"]), (200, "glm-4-flash"))
            status, d = self.post("/api/diagnose", {"resume": "技能：会使用 Python 和 Pandas 做数据清洗，会用 Excel 统计数据",
                                                    "job_id": "ai_trainer_annotator", "llm": k})
            self.assertEqual(status, 200)
            self.assertFalse(d["demo"])
            self.assertEqual(d["key"], "user")
            self.assertNotIn("synthetic-test-credential", json.dumps(d))
            self.assertEqual(seen[-1].base_url, "https://open.bigmodel.cn/api/paas/v4")
        finally:
            server.LLM = old
        status, r = self.post("/api/key/test", {"x": 1})
        self.assertEqual(status, 400)
        status, r = self.post("/api/diagnose", {"resume": "x" * 40, "job_id": "ai_trainer_annotator", "llm": {"provider": "evil", "api_key": "synthetic-credential"}})
        self.assertEqual(status, 400)
        _, _, body = self.get("/api/health")
        h = json.loads(body)
        self.assertTrue(h["allow_user_key"])
        self.assertIn("deepseek", [p["id"] for p in h["providers"]])

    def test_recommend_and_tips(self):
        resume = "数字媒体技术专业，熟练使用 Premiere 和 After Effects 剪辑社团宣传片，会用 Photoshop 修图，有作品集。"
        status, r = self.post("/api/recommend", {"resume": resume})
        self.assertEqual(status, 200)
        self.assertEqual(r["results"][0]["id"], "video_editor")
        status, d = self.post("/api/diagnose", {"resume": resume, "job_id": "video_editor"})
        status, t = self.post("/api/resume_tips", {"resume": resume, "diagnosis": d})
        self.assertEqual(status, 200)
        self.assertIn("rewrites", t)

    def test_rate_limit(self):
        old = server.CFG.rate_limit
        server.CFG.rate_limit = 2
        try:
            self.assertTrue(server.allow("9.9.9.9"))
            self.assertTrue(server.allow("9.9.9.9"))
            self.assertFalse(server.allow("9.9.9.9"))
            self.assertTrue(server.allow("8.8.8.8"))
        finally:
            server.CFG.rate_limit = old


    def test_feedback_is_rate_limited_without_writing_rejected_feedback(self):
        body = {"kind": "diagnose", "rating": 5, "session": "abuse-test"}
        with server._HITS_LOCK:
            server._HITS.clear()
        before = server.STORE.db.execute("SELECT COUNT(*) FROM feedback").fetchone()[0]
        with patch.object(server.CFG, "feedback_rate_limit", 2, create=True):
            self.assertEqual(self.post("/api/feedback", body)[0], 200)
            self.assertEqual(self.post("/api/feedback", body)[0], 200)
            self.assertEqual(self.post("/api/feedback", body)[0], 429)
        after = server.STORE.db.execute("SELECT COUNT(*) FROM feedback").fetchone()[0]
        self.assertEqual(after - before, 2)

    def test_stats_token_is_not_logged(self):
        logs = io.StringIO()
        with contextlib.redirect_stderr(logs):
            self.get("/stats?token=synthetic-test-password")
        self.assertNotIn("synthetic-test-password", logs.getvalue())

    def test_oversized_request_line_is_rejected(self):
        with socket.create_connection(self.httpd.server_address, timeout=5) as connection:
            connection.sendall(b"GET /" + b"a" * 65536 + b" HTTP/1.1\r\n\r\n")
            self.assertTrue(connection.recv(4096).startswith(b"HTTP/1.0 414"))

    def test_proxy_mode_requires_stats_token_even_for_loopback(self):
        with patch.object(server.CFG, "trust_proxy", True), patch.object(server.CFG, "admin_token", "test-only-password"):
            for path in ("/stats", "/api/stats", "/stats.csv"):
                with self.assertRaises(urllib.error.HTTPError) as error:
                    self.get(path)
                self.assertEqual(error.exception.code, 403)
                error.exception.close()
            self.assertEqual(self.get("/api/stats?token=test-only-password")[0], 200)

    def test_global_model_quota_rejects_before_calling_agent(self):
        with server._HITS_LOCK:
            server._HITS.clear()
        with patch.object(server.CFG, "api_key", "test-only-placeholder"), \
                patch.object(server.STORE, "reserve_model_call", return_value=False, create=True), \
                patch.object(server.AGENT, "ask") as ask:
            status, _ = self.post("/api/ask", {"question": "test question"})
        self.assertEqual(status, 429)
        ask.assert_not_called()

    def test_crawler_policy_and_readiness(self):
        status, headers, body = self.get("/robots.txt")
        self.assertEqual(status, 200)
        self.assertIn("Disallow: /", body)
        self.assertIn("noindex", headers.get("X-Robots-Tag", ""))
        self.assertEqual(self.get("/api/ready")[0], 200)

    def test_busy_server_rejects_without_accumulating_waiters(self):
        occupied = threading.BoundedSemaphore(1)
        occupied.acquire()
        started = time.monotonic()
        with patch.object(server, "SLOTS", occupied), patch.object(server.AGENT, "ask", return_value={}) as ask:
            status, _ = self.post("/api/ask", {"question": "test question"})
        self.assertEqual(status, 503)
        self.assertLess(time.monotonic() - started, 2)
        ask.assert_not_called()

if __name__ == "__main__":
    unittest.main()
