# Research: true realtime Qwen ASR streaming

Status 2026-10-27: not pursued — voice input records a whole clip and transcribes it once, see [feature-voice-message-stt.md](feature-voice-message-stt.md); this research is kept as background.

Status: **research only — no code changed.** Date: 2026-10-23.

## Where we are today

- Model: `qwen/qwen3-asr-0.6b` via OpenRouter `POST /audio/transcriptions`
  (`src/lib/server/llm/stt-client.ts`), chosen because it passes the OpenRouter
  workspace **ZDR** (zero data retention) guardrail.
- "Streaming" is simulated: `voice-input-button.svelte` records with a 2 s timeslice
  and re-uploads the **whole recording so far** to `/api/capture/transcribe-chunk`
  every ~2 s; each call returns a fresh full transcript.
- OpenRouter's transcription endpoint is request/response only — no streaming input,
  no streamed output documented for this model.

**Cost consequence.** Every partial bills all audio so far. For a recording of T
seconds with 2 s partials, billed audio ≈ T²/4 + T seconds:

| Recording | Audio billed today | Realtime would bill |
|---|---|---|
| 10 s | ~35 s | 10 s |
| 60 s | ~960 s (16× ) | 60 s |
| 3 min | ~8,300 s (46×) | 180 s |

OpenRouter's own example prices qwen3-asr-0.6b at roughly $0.000055/s of audio
(9.2 s → $0.000508), so a 60 s capture costs about **$0.053** today. Latency also grows
with length, because every partial re-transcribes from the start.

## Options

### A. Alibaba Model Studio — `qwen3-asr-flash-realtime` (hosted, true streaming)

- **Protocol:** WebSocket, `wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime?model=qwen3-asr-flash-realtime`
  (Singapore; Alibaba recommends the newer workspace domain
  `{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com`). Client sends `session.update`,
  waits for `session.updated`, streams audio (16 kHz PCM), server VAD by default
  (or manual `input_audio_buffer.commit`), ends with `session.finish`. Partial and
  final transcripts come back as events while you speak.
- **Price (Singapore, international):** **$0.000090 per second** of audio (~$0.0054 per
  minute), 10 h free quota for 90 days. A 60 s capture ≈ **$0.0054** — about **10×
  cheaper** than today's re-upload scheme, and it stays linear. (A newer Chinese-language
  pricing page lists this in CNY with different numbers — confirm in the console.)
- **Privacy:** default retention of prompts/responses **up to 30 days**; no training on
  customer data without separate consent. **Zero data retention exists** (encrypted
  cache ≤ 24 h, not written to durable storage) in non-mainland regions incl.
  Singapore, Frankfurt, Virginia — but only for **enterprise customers via an account
  manager after a needs assessment**, enabled per workspace. Without ZDR this would
  **break the current ZDR guardrail** we hold on OpenRouter.
- **Engineering:**
  - The API key cannot go to the browser, so the server must relay: browser →
    our WebSocket → DashScope WebSocket. We run `@sveltejs/adapter-node`, so a WS
    upgrade handler on the Node server is feasible but is new infrastructure (SvelteKit
    routes don't do WebSockets natively).
  - Browser must send 16 kHz PCM (AudioWorklet resampling) instead of webm/opus.
  - Billing: per-second usage must be logged in `activity_call_log` with markup like
    every other call (pricing transparency policy); new provider config, new secret,
    no defaults (failure policy).
  - Retry policy (3×, then explicit error) applies to the session setup.

### B. Self-host Qwen3-ASR (open weights) with vLLM streaming

- Qwen open-sourced Qwen3-ASR 0.6B / 1.7B with a toolkit (`qwen-asr[vllm]`,
  `qwen-asr-serve`) that advertises unified streaming/offline inference.
- **Privacy:** best possible — audio never leaves our infrastructure; ZDR by construction.
- **Cost:** a GPU host running permanently (or scale-to-zero with cold starts);
  only worth it at volume. Streaming behaviour under a true live audio stream is
  **not confirmed** from the docs we found — needs a spike.
- **Engineering:** same browser PCM + server relay as A, plus operating the GPU service.

### C. Stay on OpenRouter, stop re-uploading cumulative audio

- Send only new audio per partial (or a sliding window) and stitch transcripts.
- Keeps ZDR and the provider; cuts cost back to ~linear.
- **Not real streaming** and accuracy drops at slice boundaries (words cut mid-way);
  stitching meaning across slices would need care to avoid string heuristics.

## Recommendation

1. **If ZDR is non-negotiable (current policy): Option B spike**, or C as a cheap
   interim. A without an enterprise ZDR agreement weakens privacy for everyone's voice
   notes.
2. **If you can get Alibaba enterprise ZDR on a Singapore/Frankfurt workspace: Option A.**
   It's the real thing — live partials, ~10× cheaper than today, linear cost — and the
   engineering (WS relay + PCM worklet + usage logging) is a contained change.

## Decisions needed

- Is losing ZDR acceptable for voice (A without enterprise ZDR)? Or pursue Alibaba
  enterprise ZDR first?
- Region: Singapore (free quota) vs Frankfurt (EU users) — Frankfurt pricing for the
  realtime model is not listed; needs the console.
- Is a self-hosted GPU (B) in scope operationally?

## Sources

- Alibaba Cloud Model Studio pricing: https://www.alibabacloud.com/help/en/model-studio/model-pricing
- Model Studio data retention policy: https://www.alibabacloud.com/help/tc/model-studio/data-retention-policy
- Qwen-ASR-Realtime WebSocket guide: https://www.alibabacloud.com/help/en/model-studio/qwen-asr-message-websocket-api
- Realtime WebSocket overview: https://www.alibabacloud.com/help/en/model-studio/realtime-websocket-overview
- Qwen-ASR-Realtime interaction process: https://help.aliyun.com/en/model-studio/qwen-asr-realtime-interaction-process
- Qwen3-ASR 0.6B model card: https://huggingface.co/Qwen/Qwen3-ASR-0.6B
- OpenRouter qwen3-asr-0.6b: https://openrouter.ai/qwen/qwen3-asr-0.6b
