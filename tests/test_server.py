import json
import contextlib
import io
import os
import socket
import sys
import tempfile
import threading
import unittest
import urllib.request
import time
from unittest.mock import patch
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
