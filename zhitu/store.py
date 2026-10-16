"""Usage and feedback statistics. Resume / job text is never stored."""
import csv
import io
import sqlite3
import threading
import time
from pathlib import Path


class Store:
    def __init__(self, path: Path):
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.lock = threading.Lock()
        with self.lock:
            self.db.executescript("""
            CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, ts REAL, kind TEXT, ok INTEGER, ms INTEGER,
                score INTEGER, session TEXT, demo INTEGER);
            CREATE TABLE IF NOT EXISTS feedback(id INTEGER PRIMARY KEY, ts REAL, kind TEXT, rating INTEGER,
                useful INTEGER, comment TEXT, session TEXT);
            """)
            self.db.commit()

    def event(self, kind: str, ok: bool, ms: int, score: int | None, session: str, demo: bool):
        with self.lock:
            self.db.execute("INSERT INTO events(ts,kind,ok,ms,score,session,demo) VALUES(?,?,?,?,?,?,?)",
                            (time.time(), kind, int(ok), ms, score, session[:40], int(demo)))
            self.db.commit()

    def feedback(self, kind: str, rating: int, useful: bool | None, comment: str, session: str):
        rating = max(1, min(5, int(rating)))
        with self.lock:
            self.db.execute("INSERT INTO feedback(ts,kind,rating,useful,comment,session) VALUES(?,?,?,?,?,?)",
                            (time.time(), kind[:20], rating, None if useful is None else int(useful),
                             (comment or "")[:300], session[:40]))
            self.db.commit()

    def stats(self) -> dict:
        with self.lock:
            q = self.db.execute
            users = q("SELECT COUNT(DISTINCT session) FROM events WHERE demo=0").fetchone()[0]
            by_kind = {}
            for kind, n, ok, ms in q("SELECT kind, COUNT(*), SUM(ok), AVG(ms) FROM events WHERE demo=0 GROUP BY kind"):
                by_kind[kind] = {"count": n, "success_rate": round(ok / n, 3) if n else 0, "avg_ms": round(ms or 0)}
            fb = {}
            for kind, n, avg, useful, un in q("SELECT kind, COUNT(*), AVG(rating), SUM(useful), COUNT(useful) FROM feedback GROUP BY kind"):
                fb[kind] = {"count": n, "avg_rating": round(avg or 0, 2), "useful_rate": round(useful / un, 3) if un else None}
            comments = [{"kind": k, "rating": r, "comment": c} for k, r, c in
                        q("SELECT kind, rating, comment FROM feedback WHERE comment<>'' ORDER BY id DESC LIMIT 30")]
        return {"users": users, "events": by_kind, "feedback": fb, "comments": comments}

    def csv(self) -> str:
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["table", "time", "kind", "ok_or_rating", "ms_or_useful", "score_or_comment", "session"])
        with self.lock:
            for ts, kind, ok, ms, score, s in self.db.execute("SELECT ts,kind,ok,ms,score,session FROM events WHERE demo=0"):
                w.writerow(["event", time.strftime("%Y-%m-%d %H:%M", time.localtime(ts)), kind, ok, ms, score, s])
            for ts, kind, r, u, c, s in self.db.execute("SELECT ts,kind,rating,useful,comment,session FROM feedback"):
                w.writerow(["feedback", time.strftime("%Y-%m-%d %H:%M", time.localtime(ts)), kind, r, u, c, s])
        return "﻿" + buf.getvalue()  # BOM so Excel opens Chinese correctly
