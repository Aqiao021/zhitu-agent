"""Mask personal identifiers before any text leaves this computer."""
import re

_RULES = [
    ("身份证号", re.compile(r"(?<![0-9])[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[0-9Xx](?![0-9])")),
    ("手机号", re.compile(r"(?<![0-9])(?:\+?86[- ]?)?1[3-9]\d[- ]?\d{4}[- ]?\d{4}(?![0-9])")),
    ("邮箱", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")),
    ("QQ号", re.compile(r"(?i)(?:qq|QQ号?)[:：\s]*\d{5,11}")),
    ("微信号", re.compile(r"(?:微信号?|wechat|WeChat|vx|VX)[:：\s]*[A-Za-z][-_A-Za-z0-9]{5,19}")),
    ("住址", re.compile(r"(?:家庭住址|住址|现居住地|地址)[:：]\s*[^\n，,。；;]{4,40}")),
]


def mask(text: str) -> tuple[str, dict[str, int]]:
    """Return masked text and a count of each kind of item removed."""
    counts: dict[str, int] = {}
    out = text or ""
    for name, rx in _RULES:
        out, n = rx.subn(f"[已隐藏{name}]", out)
        if n:
            counts[name] = n
    return out, counts
