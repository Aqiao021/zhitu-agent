"""Small sourced knowledge base: Markdown files in kb/ indexed with SQLite FTS5 (Chinese bigrams)."""
import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path

_CJK = re.compile(r"[一-鿿]")
_STOP = set("的了和是在与及或等为对把被就也都而且并其之这那有我你他她它们吗呢吧啊怎么什么如何哪些可以能否需要")


def tokens(text: str) -> list[str]:
    out: list[str] = []
    for run in re.findall(r"[一-鿿]+|[A-Za-z0-9.+#-]+", text):
        if _CJK.match(run):
            chars = [c for c in run]
            out += [c for c in chars if c not in _STOP]
            out += [a + b for a, b in zip(chars, chars[1:])]
        else:
            out.append(run.lower())
    return out


@dataclass
class Chunk:
    id: int
    doc: str
    title: str
    section: str
    text: str
    source: str
    url: str
    date: str

    def cite(self) -> dict:
        return {"title": self.title, "section": self.section, "source": self.source, "url": self.url,
                "date": self.date, "text": self.text}


def _parse(path: Path) -> tuple[dict, str]:
    raw = path.read_text(encoding="utf-8")
    meta: dict = {}
    if raw.startswith("---"):
        head, _, body = raw[3:].partition("\n---")
        for line in head.strip().splitlines():
            k, _, v = line.partition(":")
            meta[k.strip()] = v.strip()
        raw = body
    return meta, raw


def _sections(body: str) -> list[tuple[str, str]]:
    parts, cur, buf = [], "概述", []
    for line in body.splitlines():
        if line.startswith("## "):
            if "".join(buf).strip():
                parts.append((cur, "\n".join(buf).strip()))
            cur, buf = line[3:].strip(), []
        elif not line.startswith("# "):
            buf.append(line)
    if "".join(buf).strip():
        parts.append((cur, "\n".join(buf).strip()))
    out = []
    for sec, text in parts:  # keep chunks short so citations stay precise
        paras, acc = [p for p in re.split(r"\n\s*\n", text) if p.strip()], ""
        for p in paras:
            if len(acc) + len(p) > 500 and acc:
                out.append((sec, acc.strip()))
                acc = ""
            acc += p + "\n"
        if acc.strip():
            out.append((sec, acc.strip()))
    return out


class KnowledgeBase:
    def __init__(self, folder: Path):
        self.db = sqlite3.connect(":memory:", check_same_thread=False)
        self.db.execute("CREATE VIRTUAL TABLE idx USING fts5(tok, tokenize='unicode61')")
        self.chunks: list[Chunk] = []
        for path in sorted(folder.glob("*.md")):
            meta, body = _parse(path)
            for sec, text in _sections(body):
                c = Chunk(len(self.chunks), path.stem, meta.get("title", path.stem), sec, text,
                          meta.get("source", ""), meta.get("url", ""), meta.get("date", ""))
                self.chunks.append(c)
                self.db.execute("INSERT INTO idx(rowid, tok) VALUES (?, ?)",
                                (c.id, " ".join(tokens(c.title + " " + sec + " " + text))))
        self.db.commit()

    def search(self, query: str, k: int = 5) -> list[Chunk]:
        q = sorted(set(tokens(query)))
        if not q:
            return []
        match = " OR ".join('"' + t.replace('"', "") + '"' for t in q)
        rows = self.db.execute("SELECT rowid, bm25(idx) FROM idx WHERE idx MATCH ? ORDER BY bm25(idx) LIMIT ?",
                               (match, k)).fetchall()
        return [self.chunks[r[0]] for r in rows]

    def documents(self) -> list[dict]:
        seen, out = set(), []
        for c in self.chunks:
            if c.doc not in seen:
                seen.add(c.doc)
                out.append({"title": c.title, "source": c.source, "url": c.url, "date": c.date})
        return out
