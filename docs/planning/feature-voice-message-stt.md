# Feature: voice messages (whole-clip speech-to-text)

Status: **approved by the operator 2026-10-27** — replaces segmented STT (`feature-segmented-stt.md`,
deleted with this change). Risk: **high** (voice feeds capture; the transcript becomes `thought.raw_text`).
Contribute board item: "Asr is broken" (bc9dedc6).

## 1. Problem

The mic cuts the recording into 3–10 s pieces at pauses, judged from an `AnalyserNode` loudness
level, uploads each piece and joins the texts. That design breaks in several ways:

- On iOS the `AudioContext` is created after `await getUserMedia` (outside the tap), can stay
  suspended and read flat silence (WebKit 180522) → every piece is judged silent and skipped →
  "No speech detected". The level gate also drops quiet speech everywhere.
- Restarting `MediaRecorder` per piece loses audio at the cut; iOS 26.0–26.1 truncate the end of
  MP4 recordings (WebKit 299164) — every piece loses its tail. The forced 10 s cut splits words.
- Short pieces make the ASR model invent text (Spanish "Ahora.", Chinese) and lose the context
  that mixed German/English needs.
- One failed piece discards the whole recording.

Research: on-device recognition is not robust on phones in 2026 (Web Speech sends audio to Apple/
Google on iOS/Android; in-browser Whisper good enough for German is ~560 MB and crashes iOS tabs).
Hosted, whole-clip transcription is what ChatGPT dictation and AudioPen do.

## 2. Goal

Tapping the mic records a **voice message**: a live waveform and a timer instead of live text.
Send transcribes the **whole clip once** with one well-defined process (OpenRouter
`qwen/qwen3-asr-1.7b`), shows that it is transcribing, then **sends the text straight away** through
the surface's normal send. Audio is never stored; only the transcript is.

## 3. Scope

**In scope** — every surface with a mic (all through `glass-writer.svelte` → `voice-input-button.svelte`):
Capture (`/capture`), Ask (`/chat`), Contribute (`share-composer.svelte`). The Mesh inline editor has
no mic today and stays without one.

- VM-1 **Recording state.** Tapping the mic swaps the field for a voice-message bar: live scrolling
  waveform (from the mic level), elapsed timer, a discard button and a send button. The text already
  typed in the field is kept (not shown while recording).
- VM-2 **Recording.** One `MediaRecorder` per tap, `timeslice` 1000 ms, chunks held **in memory
  only**. MIME preference: `audio/webm;codecs=opus` → `audio/mp4` → recorder default;
  `audioBitsPerSecond: 32000`. `getUserMedia` fresh per tap; all tracks stopped when the clip ends.
- VM-3 **Waveform is display only.** The `AudioContext` is created and `resume()`d synchronously in
  the tap handler (before any `await`). The level never decides what is uploaded — there is no
  silence gate. A suspended context only means a flat waveform; the recording still works.
- VM-4 **Send.** Stops the recorder, shows a transcribing state (the frozen waveform with a working
  indicator and "Transcribing…"; field locked), uploads the whole clip once to
  `POST /api/capture/transcribe`. On success the transcript is appended to the typed text
  (`appendVoiceTranscript`) and the surface's submit runs immediately — no extra tap.
- VM-5 **Discard.** Stops and drops the clip; nothing is uploaded; the field is back as it was.
- VM-6 **Failure.** The server retries the OpenRouter call exactly 3 times (one layer; the client
  sends once). If it still fails, the bar shows the plain error and keeps the clip in memory with
  **Retry** and **Discard**. 402 shows the billing message. Nothing is submitted. Leaving the page
  drops the clip (no persistence by design).
- VM-7 **Empty transcript** → "No speech detected"; nothing is submitted; Retry/Discard as in VM-6.
- VM-8 **Length cap.** 5 minutes, visible in the timer; at the cap the clip is sent as if Send was
  tapped.
- VM-9 **One model.** `qwen/qwen3-asr-1.7b` is fixed in code; the `LLM_MODEL_STT` override is removed.
  No language hint (the model identifies the language). Billing/usage log: one entry per clip.
- VM-10 **Upload size.** Server limit: an explicit constant sized for 5 min of the largest format a
  recorder emits at 32 kbps (with headroom), oversize → 400 naming the limit. adapter-node's
  default `BODY_SIZE_LIMIT` (512 KB) would reject a whole clip: set `BODY_SIZE_LIMIT` explicitly in
  the `Dockerfile` (and `.env.example`) above that constant.
- VM-11 **Delete what this replaces.** `src/lib/capture/segmented-stt.ts` + spec,
  `/api/capture/transcribe-chunk` + spec, segment metadata (`x-audio-meta`, `STT_SEGMENT_*`),
  `onpartialtranscript` everywhere (writer, Capture, Ask, Contribute), the old button internals,
  `feature-segmented-stt.md`.

**Out of scope:** on-device recognition, live text while speaking, storing audio anywhere (browser
storage or server), changing provider or model, a mic for the Mesh inline editor.

## 4. Contracts

- `POST /api/capture/transcribe` — body: the raw audio blob, `content-type` = its audio MIME (raw
  audio stays exempt from the CSRF origin check; keep the multipart path only if a test still needs
  it — otherwise delete it). Response `200 { transcript: string }` (`""` = no speech), `400` empty /
  oversize / unsupported type, `401`, `402` billing, `5xx` after 3 provider attempts with a plain
  message.
- `voice-input-button` → writer: `ontranscript(text)` once per successful clip, `onerror(message)`,
  `onstart`, `onstop`; no partial callback. The writer submits after `ontranscript` has updated the
  value.

## 5. Acceptance criteria (Given / When / Then)

- AC-1 Given any of Capture, Ask, Contribute, when I tap the mic, then the voice bar with a moving
  waveform and a running timer replaces the field, and no request is made.
- AC-2 Given a recording, when I tap send, then the transcribing state shows, exactly one
  `POST /api/capture/transcribe` carries the whole clip, and on success the transcript (after any
  typed text) is submitted through that surface's normal send.
- AC-3 Given a recording, when I tap discard, then nothing is uploaded and the field shows what I
  had typed.
- AC-4 Given the transcribe request fails, then the error shows with Retry and Discard, nothing is
  submitted, and Retry uploads the same clip again.
- AC-5 Given a 402, then the billing message shows and nothing is submitted.
- AC-6 Given an empty transcript, then "No speech detected" shows and nothing is submitted.
- AC-7 Given very quiet speech (level below any threshold), then the clip is still uploaded — no
  level gate exists.
- AC-8 Given 5 minutes of recording, then the clip is sent automatically.
- AC-9 Given a clip, then the server makes one transcription call (≤ 3 attempts) with
  `qwen/qwen3-asr-1.7b` and writes one usage-log entry; no audio is written to the DB, logs or
  browser storage.
- AC-10 Given an upload over the limit, then 400 names the limit.

## 6. Test plan (tests first)

- Unit: recorder session state machine with fake `MediaRecorder`/`getUserMedia` (idle → recording →
  transcribing → done/error; discard; retry reuses the clip; cap auto-send; AudioContext created
  before the first await); transcribe client (status mapping, 402); server route (size, type, one
  call, model fixed, no `LLM_MODEL_STT`).
- Component (vitest browser): writer shows the voice bar, then the transcribing state, then calls
  submit with the joined text.
- E2E (`src/routes/e2e/voice-capture.e2e.ts`, headed): Capture, Ask and Contribute — record → send →
  text submitted; discard; failure → Retry.
- Coverage tier: high (80%).

## 7. Decisions (operator, 2026-10-27)

- Whole clip after send, no live text; waveform + transcribing feedback.
- The transcript is sent straight away (no review step).
- Audio is never stored; only the transcript.
- One process: OpenRouter `qwen/qwen3-asr-1.7b`.
- Every mic surface (Capture, Ask, Contribute).
