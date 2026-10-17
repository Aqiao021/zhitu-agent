"""Configuration: config.json in the project root, overridable by environment variables."""
import json
import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


@dataclass
class Config:
    provider: str = "openai"          # "openai"（OpenAI 兼容接口：DeepSeek/通义/智谱/Kimi 等） 或 "anthropic"
    base_url: str = "https://api.deepseek.com"
    api_key: str = ""
    model: str = "deepseek-flash"
    timeout: int = 120                # 单次模型请求最长等待秒数（30 天计划输出较长），避免“卡住”
    host: str = "0.0.0.0"
    port: int = 8000
    admin_token: str = ""             # 统计页口令；为空时只允许本机访问统计
    rate_limit: int = 30              # 每个 IP 每 10 分钟最多调用模型的次数（公网部署防刷）
    global_rate_limit: int = 120
    daily_limit: int = 1000
    feedback_rate_limit: int = 10
    max_concurrency: int = 4          # 同时处理的模型请求数上限
    trust_proxy: bool = False         # 部署在 Nginx/云平台反向代理后面时设为 true，按 X-Forwarded-For 识别 IP
    data_dir: Path = field(default_factory=lambda: ROOT / "data")
    allow_user_key: bool = True       # 允许访客在网页上填写自己的 API Key（只随请求转发，不保存）
    user_providers: list = field(default_factory=list)  # 额外允许的服务商：[{id,name,provider,base_url,model}]

    @property
    def demo(self) -> bool:
        return not self.api_key


def load(path: Path | None = None) -> Config:
    cfg = Config()
    path = path or ROOT / "config.json"
    if path.exists():
        raw = json.loads(path.read_text(encoding="utf-8"))
        for k, v in raw.items():
            if hasattr(cfg, k) and k != "data_dir":
                setattr(cfg, k, v)
    env = {
        "ZHITU_PROVIDER": "provider", "ZHITU_BASE_URL": "base_url", "ZHITU_API_KEY": "api_key",
        "ZHITU_MODEL": "model", "ZHITU_PORT": "port", "ZHITU_ADMIN_TOKEN": "admin_token", "ZHITU_HOST": "host",
        "ZHITU_RATE_LIMIT": "rate_limit", "ZHITU_MAX_CONCURRENCY": "max_concurrency", "ZHITU_TRUST_PROXY": "trust_proxy",
        "ZHITU_GLOBAL_RATE_LIMIT": "global_rate_limit", "ZHITU_DAILY_LIMIT": "daily_limit",
        "ZHITU_FEEDBACK_RATE_LIMIT": "feedback_rate_limit",
        "ZHITU_TIMEOUT": "timeout", "PORT": "port", "ZHITU_ALLOW_USER_KEY": "allow_user_key",
    }
    for e, k in env.items():
        v = os.environ.get(e)
        if not v:
            continue
        if k in ("port", "rate_limit", "max_concurrency", "timeout", "global_rate_limit", "daily_limit", "feedback_rate_limit"):
            setattr(cfg, k, int(v))
        elif k in ("trust_proxy", "allow_user_key"):
            setattr(cfg, k, v.lower() in ("1", "true", "yes"))
        else:
            setattr(cfg, k, v)
    if os.environ.get("ZHITU_DATA_DIR"):
        cfg.data_dir = Path(os.environ["ZHITU_DATA_DIR"])
    cfg.data_dir.mkdir(parents=True, exist_ok=True)
    return cfg
