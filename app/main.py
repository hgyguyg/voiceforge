"""造声 VOICEFORGE —— 用一句话锻造一副不存在的声音。"""
from __future__ import annotations

import os
import re
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import dashscope_client as ds
import store

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"

app = FastAPI(title="造声 VOICEFORGE", docs_url="/api/docs")

store.init_db()
app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")
app.mount("/audio", StaticFiles(directory=str(store.AUDIO_DIR)), name="audio")


# ---------- 请求模型 ----------

class DesignReq(BaseModel):
    prompt: str = Field(..., min_length=2, max_length=500)
    preview_text: str | None = Field(None, max_length=200)


class CardReq(BaseModel):
    draft_id: str
    name: str = Field(..., min_length=1, max_length=24)
    accent: str = "ember"


class SayReq(BaseModel):
    text: str = Field(..., min_length=1, max_length=300)


ACCENTS = {"ember", "moss", "tide", "plum", "sand", "ink"}

DEFAULT_PREVIEW = "你好，我是刚刚被造出来的声音。你听，这就是我。"


# ---------- 工具 ----------

def _prefix() -> str:
    """create_voice 的 prefix：≤10 位字母数字，用于事后归拢同一批音色。"""
    return "vf" + str(int(time.time() * 1000))[-8:]


def _clean_preview(text: str | None) -> str:
    t = (text or "").strip() or DEFAULT_PREVIEW
    # 接口要求 15–200 字符
    if len(t) < 15:
        t = t + "。" + DEFAULT_PREVIEW
    return t[:200]


def _err(e: ds.DashScopeError) -> HTTPException:
    return HTTPException(
        status_code=502,
        detail={"code": e.code, "message": e.message, "request_id": e.request_id},
    )


# ---------- API ----------

@app.post("/api/design")
def design(req: DesignReq) -> dict[str, Any]:
    """造一个声音（草稿），返回试听音频。每次调用都会得到不同的音色。"""
    prompt = req.prompt.strip()
    try:
        got = ds.design_voice(prompt, _clean_preview(req.preview_text), _prefix())
    except ds.DashScopeError as e:
        raise _err(e)

    draft_id = store.save_draft(prompt, got["voice_id"], got["preview_bytes"])
    draft = store.get_draft(draft_id)
    return {
        "draft_id": draft_id,
        "voice_id": got["voice_id"],
        "audio_url": f"/audio/{draft['preview_file']}",
        "elapsed_ms": got["elapsed_ms"],
        "prompt": prompt,
    }


@app.post("/api/cards")
def make_card(req: CardReq) -> dict[str, Any]:
    draft = store.get_draft(req.draft_id)
    if not draft:
        raise HTTPException(404, "草稿不存在或已过期，请重新造一个")
    accent = req.accent if req.accent in ACCENTS else "ember"
    cid = store.create_card(
        name=req.name.strip(),
        prompt=draft["prompt"],
        voice_id=draft["voice_id"],
        preview_file=draft["preview_file"],
        accent=accent,
    )
    store.mark_draft_used(req.draft_id)
    return {"card_id": cid, "url": f"/c/{cid}"}


@app.get("/api/cards/{card_id}")
def read_card(card_id: str) -> dict[str, Any]:
    card = store.get_card(card_id)
    if not card:
        raise HTTPException(404, "这张声音卡不存在")
    card["preview_url"] = f"/audio/{card['preview_file']}"
    return card


@app.get("/api/gallery")
def gallery() -> dict[str, Any]:
    cards = store.list_cards(60)
    for c in cards:
        c["preview_url"] = f"/audio/{c['preview_file']}"
    return {"cards": cards, "total": store.card_count()}


@app.post("/api/cards/{card_id}/say")
def say(card_id: str, req: SayReq) -> dict[str, Any]:
    card = store.get_card(card_id)
    if not card:
        raise HTTPException(404, "这张声音卡不存在")
    text = req.text.strip()[:300]
    try:
        audio = ds.synthesize(text, card["voice_id"])
    except ds.DashScopeError as e:
        raise _err(e)
    fname = store.save_synth(audio, "say")
    store.bump(card_id, "speaks")
    return {"audio_url": f"/audio/{fname}", "text": text}


@app.post("/api/cards/{card_id}/play")
def play(card_id: str) -> dict[str, bool]:
    if not store.get_card(card_id):
        raise HTTPException(404, "这张声音卡不存在")
    store.bump(card_id, "plays")
    return {"ok": True}


@app.get("/api/qr")
def qr(d: str) -> Response:
    """把任意链接画成二维码，给分享卡片用。"""
    import io

    import qrcode
    from qrcode.constants import ERROR_CORRECT_M

    q = qrcode.QRCode(version=None, error_correction=ERROR_CORRECT_M, box_size=10, border=1)
    q.add_data(d[:800])
    q.make(fit=True)
    img = q.make_image(fill_color="#0a0a0d", back_color="#ffffff")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png")


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "ok": bool(ds.get_key()),
        "cards": store.card_count(),
        "model": ds.TARGET_MODEL,
    }


# ---------- 页面 ----------

@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    return HTMLResponse((STATIC / "index.html").read_text(encoding="utf-8"))


@app.get("/c/{card_id}", response_class=HTMLResponse)
def card_page(card_id: str) -> HTMLResponse:
    return HTMLResponse((STATIC / "card.html").read_text(encoding="utf-8"))
