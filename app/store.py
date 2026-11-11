"""SQLite 存储：声音卡片 + 草稿音色。"""
from __future__ import annotations

import os
import secrets
import sqlite3
import string
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
AUDIO_DIR = DATA_DIR / "audio"
DB_PATH = DATA_DIR / "voiceforge.db"

DATA_DIR.mkdir(parents=True, exist_ok=True)
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

ALPHABET = string.ascii_lowercase + string.digits


def short_id(n: int = 7) -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(n))


@contextmanager
def conn():
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    try:
        yield c
        c.commit()
    finally:
        c.close()


def init_db() -> None:
    with conn() as c:
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS cards (
                id           TEXT PRIMARY KEY,
                name         TEXT NOT NULL,
                prompt       TEXT NOT NULL,
                voice_id     TEXT NOT NULL,
                preview_file TEXT NOT NULL,
                accent       TEXT NOT NULL DEFAULT 'ember',
                created_at   REAL NOT NULL,
                plays        INTEGER NOT NULL DEFAULT 0,
                speaks       INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS drafts (
                id           TEXT PRIMARY KEY,
                prompt       TEXT NOT NULL,
                voice_id     TEXT NOT NULL,
                preview_file TEXT NOT NULL,
                created_at   REAL NOT NULL,
                used         INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_drafts_created ON drafts(created_at);
            """
        )


def save_draft(prompt: str, voice_id: str, preview_bytes: bytes) -> str:
    did = short_id()
    fname = f"draft_{did}.wav"
    (AUDIO_DIR / fname).write_bytes(preview_bytes)
    with conn() as c:
        c.execute(
            "INSERT INTO drafts (id, prompt, voice_id, preview_file, created_at) VALUES (?,?,?,?,?)",
            (did, prompt, voice_id, fname, time.time()),
        )
    return did


def get_draft(draft_id: str) -> dict[str, Any] | None:
    with conn() as c:
        row = c.execute("SELECT * FROM drafts WHERE id=?", (draft_id,)).fetchone()
    return dict(row) if row else None


def mark_draft_used(draft_id: str) -> None:
    with conn() as c:
        c.execute("UPDATE drafts SET used=1 WHERE id=?", (draft_id,))


def create_card(
    name: str, prompt: str, voice_id: str, preview_file: str, accent: str
) -> str:
    cid = short_id()
    # 声音文件名和卡片 id 解耦，避免草稿被清理后卡片失效
    new_name = f"card_{cid}.wav"
    src = AUDIO_DIR / preview_file
    if src.exists():
        (AUDIO_DIR / new_name).write_bytes(src.read_bytes())
    with conn() as c:
        c.execute(
            """INSERT INTO cards (id, name, prompt, voice_id, preview_file, accent, created_at)
               VALUES (?,?,?,?,?,?,?)""",
            (cid, name, prompt, voice_id, new_name, accent, time.time()),
        )
    return cid


def get_card(card_id: str) -> dict[str, Any] | None:
    with conn() as c:
        row = c.execute("SELECT * FROM cards WHERE id=?", (card_id,)).fetchone()
    return dict(row) if row else None


def list_cards(limit: int = 24) -> list[dict[str, Any]]:
    with conn() as c:
        rows = c.execute(
            "SELECT * FROM cards ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]


def bump(card_id: str, field: str) -> None:
    assert field in ("plays", "speaks")
    with conn() as c:
        c.execute(f"UPDATE cards SET {field}={field}+1 WHERE id=?", (card_id,))


def card_count() -> int:
    with conn() as c:
        row = c.execute("SELECT COUNT(*) AS n FROM cards").fetchone()
    return int(row["n"])


def save_synth(bytes_: bytes, tag: str = "say") -> str:
    fname = f"{tag}_{short_id(10)}.wav"
    (AUDIO_DIR / fname).write_bytes(bytes_)
    return fname


def prune_drafts(max_age_seconds: int = 86400) -> int:
    """删除一天前的草稿音频，避免磁盘无限增长。"""
    cutoff = time.time() - max_age_seconds
    with conn() as c:
        rows = c.execute(
            "SELECT id, preview_file FROM drafts WHERE created_at < ? AND used=0", (cutoff,)
        ).fetchall()
        for r in rows:
            p = AUDIO_DIR / r["preview_file"]
            if p.exists():
                p.unlink(missing_ok=True)
        c.execute("DELETE FROM drafts WHERE created_at < ? AND used=0", (cutoff,))
    return len(rows)
