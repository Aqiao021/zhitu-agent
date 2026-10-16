"""职途助手 — 本地网页服务（只用 Python 标准库）。运行：python server.py"""
import json
import mimetypes
import socket
import sys
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from zhitu import config as config_mod
from zhitu.agent import Agent
from zhitu.demo import DemoLLM
from zhitu.kb import KnowledgeBase
from zhitu.llm import LLM, ModelError
from zhitu.store import Store

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
MAX_BODY = 200_000

CFG = config_mod.load()
KB = KnowledgeBase(ROOT / "kb")
AGENT = Agent(DemoLLM() if CFG.demo else LLM(CFG), KB)
STORE = Store(CFG.data_dir / "zhitu.db")
SLOTS = threading.BoundedSemaphore(max(1, int(CFG.max_concurrency)))
_HITS: dict[str, deque] = {}
_HITS_LOCK = threading.Lock()


def allow(ip: str) -> bool:
    """Sliding-window rate limit: rate_limit model calls per IP per 10 minutes."""
    now = time.time()
    with _HITS_LOCK:
        q = _HITS.setdefault(ip, deque())
        while q and now - q[0] > 600:
            q.popleft()
        if len(q) >= int(CFG.rate_limit):
            return False
        q.append(now)
        if len(_HITS) > 5000:  # bound memory
            for k in [k for k, v in _HITS.items() if not v][:1000]:
                _HITS.pop(k, None)
        return True

CSP = ("default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
       "font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data:; script-src 'self'; "
       "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")


class Handler(BaseHTTPRequestHandler):
    server_version = "Zhitu/1.0"

    def log_message(self, fmt, *args):  # quieter console; never log request bodies
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

    # ------------------------------------------------------------ helpers
    def _send(self, code: int, body: bytes, ctype: str, extra: dict | None = None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("Referrer-Policy", "no-referrer")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, obj):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def _ip(self) -> str:
        if CFG.trust_proxy and self.headers.get("X-Forwarded-For"):
            return self.headers["X-Forwarded-For"].split(",")[0].strip()[:64]
        return self.client_address[0]

    def _admin_ok(self) -> bool:
        token = parse_qs(urlparse(self.path).query).get("token", [""])[0]
        local = self._ip() in ("127.0.0.1", "::1") and not self.headers.get("X-Forwarded-For")
        return local or (CFG.admin_token and token == CFG.admin_token)

    # ------------------------------------------------------------ GET
    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/health":
            return self._json(200, {"ok": True, "demo": CFG.demo, "model": "演示模式" if CFG.demo else CFG.model,
                                    "documents": KB.documents()})
        if path in ("/api/stats", "/stats.csv"):
            if not self._admin_ok():
                return self._json(403, {"error": "统计页只允许本机访问，或在网址后加 ?token=口令"})
            if path == "/stats.csv":
                return self._send(200, STORE.csv().encode("utf-8"), "text/csv; charset=utf-8",
                                  {"Content-Disposition": "attachment; filename=zhitu_stats.csv"})
            return self._json(200, STORE.stats())
        if path == "/api/ready":
            return self._json(200, {"ok": True})
        name = "index.html" if path in ("/", "") else ("stats.html" if path == "/stats" else path.lstrip("/"))
        target = (WEB / name).resolve()
        if WEB not in target.parents or not target.is_file():
            return self._send(404, "未找到".encode("utf-8"), "text/plain; charset=utf-8")
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        self._send(200, target.read_bytes(), ctype)

    # ------------------------------------------------------------ POST
    def do_POST(self):
        path = urlparse(self.path).path
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            return self._json(413, {"error": "内容为空或太长（上限约 20 万字节）"})
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            assert isinstance(body, dict)
        except Exception:
            return self._json(400, {"error": "请求格式不正确"})
        session = str(body.get("session", ""))[:40]
        routes = {
            "/api/diagnose": lambda: AGENT.diagnose(str(body.get("resume", "")), str(body.get("jd", ""))),
            "/api/plan": lambda: AGENT.plan(body.get("diagnosis") or {}, body.get("weekly_hours", 10)),
            "/api/interview": lambda: AGENT.interview(body.get("diagnosis") or {}, body.get("history") or [],
                                                      body.get("rounds", 5)),
            "/api/ask": lambda: AGENT.ask(str(body.get("question", ""))),
        }
        if path == "/api/feedback":
            try:
                STORE.feedback(str(body.get("kind", "")), int(body.get("rating", 0)), body.get("useful"),
                               str(body.get("comment", "")), session)
            except (TypeError, ValueError):
                return self._json(400, {"error": "评分需要 1～5"})
            return self._json(200, {"ok": True})
        if path not in routes:
            return self._json(404, {"error": "未知接口"})
        kind = path.rsplit("/", 1)[1]
        if not CFG.demo and not allow(self._ip()):
            return self._json(429, {"error": "使用太频繁啦，请 10 分钟后再试"})
        if not SLOTS.acquire(timeout=30):
            return self._json(503, {"error": "当前使用人数较多，请稍后再试"})
        t0 = time.time()
        try:
            result = routes[path]()
        except ModelError as e:
            STORE.event(kind, False, int((time.time() - t0) * 1000), None, session, CFG.demo)
            return self._json(502, {"error": str(e)})
        except Exception:
            STORE.event(kind, False, int((time.time() - t0) * 1000), None, session, CFG.demo)
            return self._json(500, {"error": "处理失败，请稍后重试"})
        finally:
            SLOTS.release()
        ms = int((time.time() - t0) * 1000)
        score = result.get("match_score") if kind == "diagnose" else result.get("total") if kind == "interview" else None
        STORE.event(kind, True, ms, score, session, CFG.demo)
        result["demo"] = CFG.demo
        result["elapsed_ms"] = ms
        self._json(200, result)


def lan_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "127.0.0.1"


def main():
    httpd = ThreadingHTTPServer((CFG.host, int(CFG.port)), Handler)
    mode = "演示模式（未配置 API Key）" if CFG.demo else f"模型 {CFG.model}"
    print(f"\n职途助手已启动：{mode}")
    print(f"  本机打开： http://127.0.0.1:{CFG.port}")
    print(f"  同一 Wi-Fi 的手机打开： http://{lan_ip()}:{CFG.port}")
    print(f"  试用统计（仅本机）： http://127.0.0.1:{CFG.port}/stats")
    print("  按 Ctrl+C 停止\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
