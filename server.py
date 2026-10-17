"""职途助手 — 本地网页服务（只用 Python 标准库）。运行：python server.py"""
import json
import mimetypes
import secrets
import socket
import sys
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from zhitu import config as config_mod
from zhitu.agent import Agent
from zhitu.demo import DemoLLM
from zhitu.jobs import JobDB
from zhitu.kb import KnowledgeBase
from zhitu.llm import LLM, ModelError
from zhitu.privacy import mask
from zhitu.store import Store
from zhitu.userkey import public_providers, user_config

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
MAX_BODY = 200_000

CFG = config_mod.load()
KB = KnowledgeBase(ROOT / "kb")
STORE = Store(CFG.data_dir / "zhitu.db")
JOBS = JobDB(ROOT / "kb" / "jobs.json", CFG.data_dir / "zhitu.db")
AGENT = Agent(DemoLLM() if CFG.demo else LLM(CFG), KB, JOBS)
SLOTS = threading.BoundedSemaphore(max(1, int(CFG.max_concurrency)))
_HITS: dict[tuple[str, str, int], deque] = {}
_HITS_LOCK = threading.Lock()


def allow(ip: str, bucket: str = "model", limit: int | None = None, window: int = 600) -> bool:
    """Bounded sliding-window limiter; feedback and model requests have separate buckets."""
    now = time.monotonic()
    limit = int(CFG.rate_limit if limit is None else limit)
    key = (bucket, ip, window)
    with _HITS_LOCK:
        if key not in _HITS and len(_HITS) >= 5000:
            for k in [k for k, v in _HITS.items() if not v or now - v[-1] >= k[2]]:
                _HITS.pop(k, None)
            if len(_HITS) >= 5000:
                return False
        q = _HITS.setdefault(key, deque())
        while q and now - q[0] >= window:
            q.popleft()
        if len(q) >= limit:
            return False
        q.append(now)
        return True

CSP = ("default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
       "font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data:; script-src 'self'; "
       "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")


class Handler(BaseHTTPRequestHandler):
    server_version = "Zhitu/1.0"

    def log_message(self, fmt, *args):  # quieter console; never log request bodies
        message = fmt % args
        path = getattr(self, "path", "")
        if path:
            message = message.replace(path, urlparse(path).path)
        sys.stderr.write("%s %s\n" % (self.address_string(), message))

    # ------------------------------------------------------------ helpers
    def _send(self, code: int, body: bytes, ctype: str, extra: dict | None = None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Robots-Tag", "noindex, nofollow, noarchive")
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
        if CFG.admin_token:
            return secrets.compare_digest(token.encode("utf-8"), CFG.admin_token.encode("utf-8"))
        return (not CFG.trust_proxy and self.client_address[0] in ("127.0.0.1", "::1")
                and not self.headers.get("X-Forwarded-For"))

    # ------------------------------------------------------------ GET
    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/robots.txt":
            return self._send(200, b"User-agent: *\nDisallow: /\n", "text/plain; charset=utf-8")
        if path in ("/stats", "/stats.html") and not self._admin_ok():
            return self._json(403, {"error": "访问统计页需要正确口令"})
        if path == "/api/health":
            return self._json(200, {"ok": True, "demo": CFG.demo, "model": "演示模式" if CFG.demo else CFG.model,
                                    "documents": KB.documents(), "server_key": not CFG.demo,
                                    "allow_user_key": bool(CFG.allow_user_key),
                                    "providers": public_providers(CFG.user_providers) if CFG.allow_user_key else []})
        if path in ("/api/stats", "/stats.csv"):
            if not self._admin_ok():
                return self._json(403, {"error": "统计页只允许本机访问，或在网址后加 ?token=口令"})
            if path == "/stats.csv":
                return self._send(200, STORE.csv().encode("utf-8"), "text/csv; charset=utf-8",
                                  {"Content-Disposition": "attachment; filename=zhitu_stats.csv"})
            return self._json(200, STORE.stats())
        if path == "/api/ready":
            return self._json(200, {"ok": True})
        if path == "/api/majors":
            return self._json(200, {"majors": JOBS.majors(), "notice": JOBS.notice, "updated": JOBS.updated,
                                    "total_jobs": len(JOBS.all())})
        if path == "/api/jobs":
            qs = parse_qs(urlparse(self.path).query)
            return self._json(200, {"results": JOBS.search(qs.get("q", [""])[0], qs.get("major", [""])[0])})
        if path == "/api/jobs/common":
            ids = parse_qs(urlparse(self.path).query).get("ids", [""])[0].split(",")
            job = JOBS.combine(ids)
            return self._json(200, job) if job else self._json(400, {"error": "请至少选择 2 个岗位"})
        if path.startswith("/api/jobs/"):
            job = JOBS.get(unquote(path.rsplit("/", 1)[1]))
            return self._json(200, job) if job else self._json(404, {"error": "没有找到这个岗位"})
        if path == "/api/admin/jobs":
            if not self._admin_ok():
                return self._json(403, {"error": "需要管理口令"})
            return self._json(200, {"submissions": JOBS.submissions(), "imported": JOBS.imported()})
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
        try:
            ucfg = user_config(CFG, body.get("llm"), CFG.user_providers)  # visitor's own key: used once, never stored
        except ModelError as e:
            return self._json(400, {"error": str(e)})
        body.pop("llm", None)
        agent = Agent(LLM(ucfg), KB, JOBS) if ucfg else AGENT
        demo = False if ucfg else CFG.demo
        routes = {
            "/api/diagnose": lambda: agent.diagnose(str(body.get("resume", "")), str(body.get("jd", "")),
                                                    str(body.get("job_id", ""))),
            "/api/plan": lambda: agent.plan(body.get("diagnosis") or {}, body.get("daily_hours", 2)),
            "/api/interview": lambda: agent.interview(body.get("diagnosis") or {}, body.get("history") or [],
                                                      body.get("rounds", 5)),
            "/api/ask": lambda: agent.ask(str(body.get("question", ""))),
            "/api/resume_tips": lambda: agent.resume_tips(str(body.get("resume", "")), body.get("diagnosis") or {}),
        }
        if path == "/api/recommend":
            try:
                result = AGENT.recommend(str(body.get("resume", "")))
            except ModelError as e:
                return self._json(400, {"error": str(e)})
            STORE.event("recommend", True, 0, None, session, False)
            return self._json(200, result)
        if path == "/api/key/test":
            if not ucfg:
                return self._json(400, {"error": "请先填写 API Key"})
            routes[path] = lambda: {"ok": bool(LLM(ucfg).chat("你是连接测试，只回复 OK。", [{"role": "user", "content": "ping"}], 8)),
                                    "model": ucfg.model}
        if path == "/api/feedback":
            if (not allow(self._ip(), "feedback", CFG.feedback_rate_limit, 60)
                    or not allow("*", "feedback-global", 120, 60)):
                return self._json(429, {"error": "反馈提交过于频繁，请一分钟后再试"})
            try:
                STORE.feedback(str(body.get("kind", "")), int(body.get("rating", 0)), body.get("useful"),
                               str(body.get("comment", "")), session)
            except (TypeError, ValueError):
                return self._json(400, {"error": "评分需要 1～5"})
            return self._json(200, {"ok": True})
        if path == "/api/jobs/submit":
            text = str(body.get("text", "")).strip()
            if len(text) < 40:
                return self._json(400, {"error": "招聘信息太短，至少需要 40 字"})
            if not allow(self._ip()):
                return self._json(429, {"error": "提交太频繁啦，请稍后再试"})
            JOBS.submit(mask(text)[0], str(body.get("url", "")).strip(), str(body.get("note", "")), session)
            return self._json(200, {"ok": True})
        if path.startswith("/api/admin/"):
            if not self._admin_ok():
                return self._json(403, {"error": "需要管理口令"})
            try:
                if path == "/api/admin/save":
                    job = JOBS.add_imported(body.get("job") or {})
                    if body.get("submission_id"):
                        JOBS.drop_submission(int(body["submission_id"]))
                    return self._json(200, {"ok": True, "job": JOBS.card(job)})
                if path == "/api/admin/drop":
                    JOBS.drop_submission(int(body.get("submission_id", 0)))
                    return self._json(200, {"ok": True})
                if path == "/api/admin/delete_job":
                    return self._json(200, {"ok": JOBS.remove_imported(str(body.get("id", "")))})
            except (TypeError, ValueError) as e:
                return self._json(400, {"error": str(e) or "参数不正确"})
            if path == "/api/admin/extract":
                text, url = str(body.get("text", "")), str(body.get("url", ""))
                if body.get("submission_id"):
                    sub = JOBS.take_submission(int(body["submission_id"]))
                    if not sub:
                        return self._json(404, {"error": "这条提交已不存在"})
                    text, url = sub["text"], sub["url"]
                routes[path] = lambda: {"job": agent.extract_job(text, url)}
        if path not in routes:
            return self._json(404, {"error": "未知接口"})
        kind = {"/api/admin/extract": "import", "/api/key/test": "keytest"}.get(path, path.rsplit("/", 1)[1])
        if not demo and not allow(self._ip()):
            return self._json(429, {"error": "使用太频繁啦，请 10 分钟后再试"})
        if not SLOTS.acquire(blocking=False):
            return self._json(503, {"error": "当前使用人数较多，请稍后再试"})
        t0 = time.time()
        try:
            if not demo and not ucfg and not STORE.reserve_model_call(CFG.global_rate_limit, CFG.daily_limit):
                return self._json(429, {"error": "全站模型请求已达保护上限，请稍后再试或联系管理员"})
            result = routes[path]()
        except ModelError as e:
            STORE.event(kind, False, int((time.time() - t0) * 1000), None, session, demo)
            return self._json(502, {"error": str(e)})
        except Exception:
            STORE.event(kind, False, int((time.time() - t0) * 1000), None, session, demo)
            return self._json(500, {"error": "处理失败，请稍后重试"})
        finally:
            SLOTS.release()
        ms = int((time.time() - t0) * 1000)
        score = result.get("match_score") if kind == "diagnose" else result.get("total") if kind == "interview" else None
        STORE.event(kind, True, ms, score, session, demo)
        result["demo"] = demo
        result["key"] = "user" if ucfg else "demo" if demo else "server"
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
