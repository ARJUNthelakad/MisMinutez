# MisMinutez Self-Hosted AI API (Zero Daily Quotas)

Run your own private, unlimited speech-to-text + LLM API server on your laptop, college workstation, or any cloud GPU VPS, and connect it directly to MisMinutez.

## What's Included
- **Speech-to-Text (`POST /v1/audio/transcriptions`)**: Powered by `faster-whisper` (`large-v3-turbo` by default; supports English, Malayalam, Hindi, Tamil, Kannada, Telugu, Arabic, and 90+ languages).
- **Meeting Minutes, Chat, Translation & Emails (`POST /v1/chat/completions`)**: OpenAI-compatible proxy backed by **Ollama** (`qwen2.5:7b` or `gemma3:4b`).
- **Bearer Token Security**: Optional shared token via `SELF_HOSTED_API_TOKEN`.

---

## Option A: Run with Docker Compose (Recommended)

1. Start both Ollama and the MisMinutez AI API server:
   ```bash
   cd self-hosted-ai
   export SELF_HOSTED_API_TOKEN="choose-a-strong-random-secret"
   docker compose up -d --build
   ```

2. Pull a fast multilingual LLM into Ollama (choose one based on your RAM/VRAM):
   ```bash
   # Best quality multilingual (needs ~6 GB RAM/VRAM)
   docker exec -it misminutez-ollama ollama pull qwen2.5:7b

   # Lighter & faster on CPU / 4 GB laptops
   docker exec -it misminutez-ollama ollama pull qwen2.5:3b
   ```

3. Verify your server is healthy:
   ```bash
   curl http://localhost:8000/health
   ```

---

## Option B: Run Directly Without Docker (Python + Local Ollama)

1. Install [Ollama](https://ollama.com/) and pull a model:
   ```bash
   ollama pull qwen2.5:7b
   ```
2. Install Python dependencies (requires `ffmpeg` installed on your OS):
   ```bash
   cd self-hosted-ai
   python -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   OLLAMA_BASE_URL=http://127.0.0.1:11434 \
   WHISPER_MODEL=small \
   SELF_HOSTED_API_TOKEN="choose-a-strong-random-secret" \
   uvicorn server:app --host 0.0.0.0 --port 8000
   ```

---

## Step 2: Expose Your Server Over HTTPS (So MisMinutez Cloud Can Reach It)

If MisMinutez is hosted in the cloud (AI Studio / Cloud Run), expose your local port `8000` with a free quick **Cloudflare Tunnel**:

```bash
cloudflared tunnel --url http://localhost:8000
```

This gives you a public HTTPS URL like:
`https://random-name.trycloudflare.com`

---

## Step 3: Connect to MisMinutez

In **AI Studio → Settings > Secrets** (or your server `.env`), set:

```env
AI_PROVIDER="self_hosted"
SELF_HOSTED_ASR_URL="https://random-name.trycloudflare.com/v1/audio/transcriptions"
SELF_HOSTED_LLM_URL="https://random-name.trycloudflare.com/v1/chat/completions"
SELF_HOSTED_LLM_MODEL="qwen2.5:7b"
SELF_HOSTED_API_TOKEN="choose-a-strong-random-secret"
```

> **Tip:** Set `AI_PROVIDER="auto"` if you want MisMinutez to use your self-hosted AI API whenever it is online and automatically fall back to Gemini if your computer is turned off.

MisMinutez also works with **any** OpenAI-compatible server out of the box (Ollama `/v1/chat/completions`, vLLM, LM Studio, LocalAI, Groq, Together, etc.).
