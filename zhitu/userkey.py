"""Bring-your-own-key: each visitor may use their own model API key.

The key travels with each request, is used once to call the provider, and is never stored or logged.
Only provider addresses on an allowlist are accepted, so the server cannot be pointed at internal hosts.
"""
import dataclasses
import re

from .config import Config
from .llm import ModelError

# 模型名只是默认建议，以各服务商文档为准；用户可以在网页上修改
PROVIDERS = [
    {"id": "deepseek", "name": "DeepSeek", "provider": "openai", "base_url": "https://api.deepseek.com", "model": "deepseek-flash"},
    {"id": "qwen", "name": "阿里云百炼（通义千问）", "provider": "openai", "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1", "model": "qwen-plus"},
    {"id": "zhipu", "name": "智谱 GLM", "provider": "openai", "base_url": "https://open.bigmodel.cn/api/paas/v4", "model": "glm-4-flash"},
    {"id": "moonshot", "name": "Kimi（月之暗面）", "provider": "openai", "base_url": "https://api.moonshot.cn/v1", "model": "moonshot-v1-32k"},
    {"id": "siliconflow", "name": "硅基流动", "provider": "openai", "base_url": "https://api.siliconflow.cn/v1", "model": "deepseek-ai/DeepSeek-V3"},
    {"id": "ark", "name": "火山方舟（豆包）", "provider": "openai", "base_url": "https://ark.cn-beijing.volces.com/api/v3", "model": ""},
    {"id": "openai", "name": "OpenAI", "provider": "openai", "base_url": "https://api.openai.com/v1", "model": ""},
    {"id": "anthropic", "name": "Anthropic Claude", "provider": "anthropic", "base_url": "https://api.anthropic.com/v1", "model": ""},
]
_KEY = re.compile(r"^[\x21-\x7e]{8,200}$")
_MODEL = re.compile(r"^[A-Za-z0-9._:/@-]{1,80}$")


def public_providers(extra: list[dict]) -> list[dict]:
    return [{k: p[k] for k in ("id", "name", "model")} for p in PROVIDERS + extra]


def user_config(base: Config, req: dict | None, extra: list[dict]) -> Config | None:
    """Return a per-request Config for the visitor's own key, or None when they did not send one."""
    if not isinstance(req, dict) or not req.get("api_key"):
        return None
    if not base.allow_user_key:
        raise ModelError("本站没有开放“使用自己的 API Key”")
    prov = next((p for p in PROVIDERS + extra if p["id"] == str(req.get("provider", ""))), None)
    if not prov:
        raise ModelError("不支持这个模型服务商，请在列表中选择")
    key, model = str(req["api_key"]).strip(), str(req.get("model", "") or prov["model"]).strip()
    if not _KEY.match(key):
        raise ModelError("API Key 格式不正确，请检查是否复制完整（不要带空格或中文）")
    if not _MODEL.match(model):
        raise ModelError("请填写正确的模型名（以服务商文档为准）")
    return dataclasses.replace(base, provider=prov["provider"], base_url=prov["base_url"], api_key=key, model=model)
