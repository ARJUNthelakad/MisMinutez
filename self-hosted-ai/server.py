import hmac
import os
import tempfile
from typing import Any

import httpx
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from faster_whisper import WhisperModel

APP_TITLE = "MisMinutez Self-Hosted AI API"
WHISPER_MODEL_SIZE = os.getenv("WHISPER_MODEL", "large-v3-turbo")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "auto")  # "cuda", "cpu", or "auto"
WHISPER_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://ollama:11434").rstrip("/")
DEFAULT_LLM_MODEL = os.getenv("DEFAULT_LLM_MODEL", "qwen2.5:7b")
API_TOKEN = os.getenv("SELF_HOSTED_API_TOKEN", "").strip()
MAX_AUDIO_BYTES = 25 * 1024 * 1024  # 25 MB

app = FastAPI(title=APP_TITLE, version="1.0.0")

_whisper_model: WhisperModel | None = None


def get_whisper_model() -> WhisperModel:
    global _whisper_model
    if _whisper_model is None:
        device = WHISPER_DEVICE
        if device == "auto":
            try:
                import torch  # type: ignore

                device = "cuda" if torch.cuda.is_available() else "cpu"
            except Exception:
                device = "cpu"
        _whisper_model = WhisperModel(
            WHISPER_MODEL_SIZE,
            device=device,
            compute_type=WHISPER_COMPUTE_TYPE,
        )
    return _whisper_model


def verify_bearer_token(authorization: str | None = Header(default=None)) -> None:
    if not API_TOKEN:
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    provided = authorization[len("Bearer ") :].strip()
    if not hmac.compare_digest(provided, API_TOKEN):
        raise HTTPException(status_code=403, detail="Invalid Bearer token")


@app.get("/health")
async def health() -> dict[str, Any]:
    ollama_ok = False
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            ollama_ok = r.status_code == 200
    except Exception:
        ollama_ok = False

    return {
        "ok": True,
        "service": APP_TITLE,
        "whisperModel": WHISPER_MODEL_SIZE,
        "defaultLlmModel": DEFAULT_LLM_MODEL,
        "ollamaConnected": ollama_ok,
        "authEnabled": bool(API_TOKEN),
    }


@app.post("/v1/audio/transcriptions", dependencies=[Depends(verify_bearer_token)])
async def transcribe_audio(
    file: UploadFile = File(...),
    language: str | None = Form(default=None),
    prompt: str | None = Form(default=None),
) -> JSONResponse:
    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file")
    if len(raw_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio file exceeds 25 MB limit")

    # Determine safe file extension strictly from allowlist
    ext_map = {
        "audio/webm": ".webm",
        "audio/mp4": ".m4a",
        "audio/mpeg": ".mp3",
        "audio/mp3": ".mp3",
        "audio/wav": ".wav",
        "audio/x-wav": ".wav",
        "audio/ogg": ".ogg",
    }
    base_mime = (file.content_type or "audio/webm").split(";")[0].strip().lower()
    suffix = ext_map.get(base_mime, ".webm")

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(raw_bytes)
            tmp_path = tmp.name

        model = get_whisper_model()
        segments_iter, info = model.transcribe(
            tmp_path,
            language=language or None,
            initial_prompt=prompt or None,
            vad_filter=True,
            beam_size=5,
        )

        segments_out = []
        full_text_parts = []
        for seg in segments_iter:
            text = (seg.text or "").strip()
            if not text:
                continue
            full_text_parts.append(text)
            segments_out.append(
                {
                    "start": round(float(seg.start), 2),
                    "end": round(float(seg.end), 2),
                    "text": text,
                }
            )

        return JSONResponse(
            {
                "text": " ".join(full_text_parts).strip(),
                "language": getattr(info, "language", "en") or "en",
                "duration": round(float(getattr(info, "duration", 0.0) or 0.0), 2),
                "segments": segments_out,
            }
        )
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


@app.post("/v1/chat/completions", dependencies=[Depends(verify_bearer_token)])
async def chat_completions(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON payload") from exc

    if not isinstance(payload, dict) or not isinstance(payload.get("messages"), list):
        raise HTTPException(status_code=400, detail="Missing messages array")

    payload.setdefault("model", DEFAULT_LLM_MODEL)
    payload["stream"] = False

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            upstream = await client.post(
                f"{OLLAMA_BASE_URL}/v1/chat/completions",
                json=payload,
            )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Unable to reach local Ollama server at {OLLAMA_BASE_URL}: {exc}",
        ) from exc

    if upstream.status_code >= 400:
        raise HTTPException(
            status_code=upstream.status_code,
            detail=f"Ollama upstream error: {upstream.text[:400]}",
        )

    return JSONResponse(upstream.json())
