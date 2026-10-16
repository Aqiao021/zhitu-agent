"""Model client using only the standard library (OpenAI-compatible or Anthropic Messages API)."""
import json
import re
import time
import urllib.error
import urllib.request

from .config import Config


class ModelError(RuntimeError):
    """A user-facing model error (message is safe to show)."""


class LLM:
    def __init__(self, cfg: Config):
        self.cfg = cfg

    def chat(self, system: str, messages: list[dict], max_tokens: int = 2000, temperature: float = 0.3) -> str:
        last: Exception | None = None
        for attempt in range(2):  # 最多重试 1 次，避免长时间卡住
            try:
                return self._once(system, messages, max_tokens, temperature)
            except ModelError as e:
                last = e
                if "HTTP 4" in str(e) and "HTTP 429" not in str(e):
                    break
                time.sleep(1.5 * (attempt + 1))
        raise last or ModelError("模型请求失败")

    def _once(self, system, messages, max_tokens, temperature) -> str:
        c = self.cfg
        base = c.base_url.rstrip("/")
        if c.provider == "anthropic":
            url = base + ("/messages" if base.endswith("/v1") else "/v1/messages")
            body = {"model": c.model, "max_tokens": max_tokens, "temperature": temperature,
                    "system": system, "messages": messages}
            headers = {"x-api-key": c.api_key, "anthropic-version": "2023-06-01"}
        else:
            url = base + "/chat/completions"
            body = {"model": c.model, "max_tokens": max_tokens, "temperature": temperature,
                    "messages": [{"role": "system", "content": system}] + messages}
            headers = {"Authorization": f"Bearer {c.api_key}"}
        req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), method="POST",
                                     headers={"Content-Type": "application/json", **headers})
        try:
            with urllib.request.urlopen(req, timeout=c.timeout) as r:
                data = json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            raise ModelError(f"模型接口返回 HTTP {e.code}，请检查 config.json 里的地址、模型名和密钥") from None
        except (urllib.error.URLError, TimeoutError, OSError):
            raise ModelError(f"连接模型超时或失败（等待上限 {c.timeout} 秒），请检查网络后重试") from None
        try:
            if c.provider == "anthropic":
                return "".join(b.get("text", "") for b in data["content"] if b.get("type") == "text")
            return data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError):
            raise ModelError("模型返回格式不正确") from None


def extract_json(text: str):
    """Parse the first JSON object in a model reply (tolerates ```json fences and extra prose)."""
    t = text.strip()
    m = re.search(r"```(?:json)?\s*(.*?)```", t, re.S)
    if m:
        t = m.group(1).strip()
    start = t.find("{")
    if start < 0:
        raise ModelError("模型没有返回结构化结果，请重试")
    depth, in_str, esc = 0, False, False
    for i in range(start, len(t)):
        ch = t[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(t[start:i + 1])
                except json.JSONDecodeError:
                    break
    raise ModelError("模型返回的结构化结果不完整，请重试")
