import json
import os
import sys
import tempfile
import threading
import unittest
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


if __name__ == "__main__":
    unittest.main()
