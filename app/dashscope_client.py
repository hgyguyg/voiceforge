"""阿里云百炼 CosyVoice 客户端：音色设计（voice design）+ 语音合成。"""
from __future__ import annotations

import base64
import json
import os
import subprocess
import time
from typing import Any

import httpx

BASE = "https://dashscope.aliyuncs.com"
CUSTOMIZATION_URL = f"{BASE}/api/v1/services/audio/tts/customization"
SYNTH_URL = f"{BASE}/api/v1/services/audio/tts/SpeechSynthesizer"

TARGET_MODEL = "cosyvoice-v3.5-plus"


def _read_key_from_registry() -> str:
    """从 Windows 用户环境变量读 Key：当前进程拿不到新设的变量，但注册表里已经有。
    非 Windows（如 Linux 容器）直接返回空，避免每次都起一个失败的 subprocess。"""
    if os.name != "nt":
        return ""
    try:
        out = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                "[Environment]::GetEnvironmentVariable('DASHSCOPE_API_KEY','User')",
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        return (out.stdout or "").strip()
    except Exception:
        return ""


def get_key() -> str:
    key = os.environ.get("DASHSCOPE_API_KEY", "").strip()
    if key:
        return key
    key = _read_key_from_registry()
    if key:
        os.environ["DASHSCOPE_API_KEY"] = key  # 缓存，避免每次请求都起 PowerShell
    return key


class DashScopeError(Exception):
    def __init__(self, status: int, code: str, message: str, request_id: str = ""):
        self.status = status
        self.code = code
        self.message = message
        self.request_id = request_id
        super().__init__(f"[{status}] {code}: {message}")


def _parse_error(resp: httpx.Response) -> DashScopeError:
    try:
        d = resp.json()
    except Exception:
        return DashScopeError(resp.status_code, "HTTPError", resp.text[:300])
    return DashScopeError(
        resp.status_code,
        d.get("code", "Unknown"),
        d.get("message", ""),
        d.get("request_id", ""),
    )


def _headers() -> dict[str, str]:
    key = get_key()
    if not key:
        raise DashScopeError(401, "MissingApiKey", "没有找到 DASHSCOPE_API_KEY")
    return {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def design_voice(
    prompt: str,
    preview_text: str,
    prefix: str,
    *,
    sample_rate: int = 24000,
    audio_format: str = "wav",
    language: str = "zh",
) -> dict[str, Any]:
    """用一句描述造一个音色。

    返回 {voice_id, preview_bytes, sample_rate, elapsed_ms}
    """
    payload = {
        "model": "voice-enrollment",
        "input": {
            "action": "create_voice",
            "target_model": TARGET_MODEL,
            "voice_prompt": prompt,
            "preview_text": preview_text,
            "prefix": prefix,
            "language_hints": [language],
        },
        "parameters": {"sample_rate": sample_rate, "response_format": audio_format},
    }
    t0 = time.perf_counter()
    with httpx.Client(timeout=120) as client:
        resp = client.post(CUSTOMIZATION_URL, headers=_headers(), json=payload)
        if resp.status_code != 200:
            raise _parse_error(resp)
        out = resp.json().get("output", {})
    audio_b64 = (out.get("preview_audio") or {}).get("data", "")
    if not audio_b64:
        raise DashScopeError(500, "EmptyPreview", "接口没有返回试听音频")
    return {
        "voice_id": out["voice_id"],
        "preview_bytes": base64.b64decode(audio_b64),
        "sample_rate": sample_rate,
        "elapsed_ms": int((time.perf_counter() - t0) * 1000),
    }


def synthesize(
    text: str,
    voice_id: str,
    *,
    model: str = TARGET_MODEL,
    sample_rate: int = 24000,
    audio_format: str = "wav",
) -> bytes:
    """用指定音色念一段文字，返回音频字节。"""
    payload = {
        "model": model,
        "input": {
            "text": text,
            "voice": voice_id,
            "format": audio_format,
            "sample_rate": sample_rate,
        },
    }
    with httpx.Client(timeout=120) as client:
        resp = client.post(SYNTH_URL, headers=_headers(), json=payload)
        if resp.status_code != 200:
            raise _parse_error(resp)
        data = resp.json()
    url = ((data.get("output") or {}).get("audio") or {}).get("url", "")
    if not url:
        raise DashScopeError(500, "NoAudioUrl", "合成接口没有返回音频地址")
    with httpx.Client(timeout=120, follow_redirects=True) as client:
        audio = client.get(url)
        audio.raise_for_status()
        return audio.content


def query_voice(voice_id: str) -> dict[str, Any]:
    payload = {
        "model": "voice-enrollment",
        "input": {"action": "query_voice", "voice_id": voice_id},
    }
    with httpx.Client(timeout=60) as client:
        resp = client.post(CUSTOMIZATION_URL, headers=_headers(), json=payload)
        if resp.status_code != 200:
            raise _parse_error(resp)
        return resp.json().get("output", {})
