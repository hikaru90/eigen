# Feature: segmented speech-to-text (interim for realtime ASR)

Status: **implemented 2026-10-23** (uncommitted) — D1 = joined segments, D2 = defaults. `/api/capture/transcribe` and `streaming-stt-scheduler.ts` deleted; logic in `src/lib/capture/segmented-stt.ts`. Headed e2e not yet green (blocked at the Early Access agreement modal in the e2e setup, before voice).
Context: [realtime-asr-research.md](realtime-asr-research.md), option C.
Risk: **high** (voice capture feeds ingestion; transcript text becomes `thought.raw_text`).

## 1. Problem

`voice-input-button.svelte` records with a 2 s timeslice. `streaming-stt-scheduler.ts`
re-sends the **whole recording so far** to `/api/capture/transcribe-chunk` after every
slice, and on stop `transcribeRecordedAudio` sends the whole recording **again**.
Billed audio ≈ T²/4 + T seconds (60 s note → ~960 s billed, ~16×). Latency grows with
length. Separately, failed partials are swallowed (`console.error`, empty partial) —
a silent degradation the failure policy forbids.

## 2. Goal

Each second of audio is transcribed **once**. Billed audio ≈ T. Live partial text keeps
appearing while you speak. Provider (OpenRouter `qwen/qwen3-asr-0.6b`) and the ZDR
guardrail stay unchanged.

## 3. Scope

**In scope**

- SEG-1 Record in **independent segments**: on the same `MediaStream`, stop and restart
  `MediaRecorder` so every segment is a complete, decodable file (a raw timeslice chunk
  after the first has no WebM header and can't be sent alone).
- SEG-2 **Cut at pauses**: end a segment when the existing level meter (`AnalyserNode`
  RMS, already in the button) stays below a silence threshold for ≥ 350 ms, once the
  segment is ≥ 3 s long; force a cut at 10 s if no pause comes. This is signal
  processing on audio level, not text analysis.
- SEG-3 Transcribe each segment exactly once, in order, through the existing
  `/api/capture/transcribe-chunk` endpoint (body = that segment only). The live partial
  shown to the user = segment transcripts so far, joined with single spaces.
- SEG-4 On stop: the last open segment is closed and transcribed; the **final transcript
  is the ordered join of all segment transcripts** — no second full-audio pass.
- SEG-5 **Fail loudly:** the server retries the OpenRouter call exactly 3 times (one layer only — the client sends each segment once); if it still
  fails, recording stops, the button shows a plain error ("Couldn't transcribe part of
  your recording — try again"), and nothing partial is submitted as a thought.
- SEG-6 Usage log: each segment call keeps its existing billing/usage entry (per-second
  audio), so the log shows N small calls instead of N growing ones.
- SEG-7 Delete what this replaces: the cumulative merge in `streaming-stt-scheduler.ts`
  and the final full-recording upload path in the button (plus specs).

**Out of scope**

- Changing provider or model; true streaming (realtime-asr-research options A/B).
- Any LLM post-processing of the joined transcript (capture's interpret pass already runs).
- Per-word timestamps, speaker labels.

## 4. Contracts

- `POST /api/capture/transcribe-chunk` — unchanged shape (`multipart` audio + language →
  `{ transcript }`), now receives one segment instead of cumulative audio. Max size can
  drop to the 10 s segment ceiling; oversize → 400 with the limit in the message.
- `/api/capture/transcribe` (full upload) — still used by non-streaming callers? To be
  confirmed during implementation; if voice-input-button was its only caller, it is
  deleted with its spec.
- Segment ordering: each request carries a client segment index; the client assembles
  by index, so a late response can't reorder text.

## 5. Failure modes

- Network blip on one segment → retry (≤ 3) → explicit error; no silent gap in the text.
- Silence-only segment → empty transcript is a valid result (not an error), contributes nothing.
- Very fast speech without pauses → forced cut at 10 s (a word may split; accepted
  trade-off, see D1).
- Credits run out mid-recording (402) → stop immediately with the billing message; no retry.
- User stops while a segment request is in flight → wait for it (and the last segment)
  before emitting the final transcript.

## 6. Acceptance criteria (Given / When / Then)

- AC-1 Given a 60 s recording with natural pauses, when the user stops, then the server
  received segments whose audio durations sum to ~60 s (± one segment), not ~960 s.
- AC-2 Given the user is speaking, when a segment closes, then the partial text updates
  within one request round-trip and earlier text is never rewritten.
- AC-3 Given three segments transcribed as "a", "b", "c" (responses arriving out of
  order), then the partial and final read "a b c".
- AC-4 Given segment 2 fails 3 times, then recording stops, an error is shown, and no
  thought is captured from the partial text.
- AC-5 Given a 402 on any segment, then no retry happens and the billing message is shown.
- AC-6 Given a 12 s stretch without any pause, then a segment is forced at 10 s.
- AC-7 Given each segment upload, then it is a standalone decodable file (starts with a
  WebM/EBML header or WAV header per recorder MIME).
- AC-8 Given a recording, then each segment produced exactly one usage-log entry.

## 7. Test plan

- Unit: segment scheduler (ordering by index, join, retry-exactly-3, 402 no-retry,
  empty segment, stop-while-in-flight); silence-cut logic with a fake level stream
  (threshold, 3 s minimum, 10 s forced cut).
- Component (vitest browser, mocked `MediaRecorder` + fetch): recorder restarts per
  segment, partial text events, error state, no final full upload.
- Integration: `transcribe-chunk` route accepts a single-segment file and rejects
  oversize with the limit message.
- E2E (headed release suite, existing fake-mic fixture): record → partials appear →
  stop → captured text equals the joined segments.
- Coverage tier: capture/voice path is high (80%).

## 8. Decisions (operator, 2026-10-23)

- **D1:** final transcript = ordered join of segment transcripts (no full-audio pass).
- **D2:** 3 s minimum / 350 ms pause / 10 s maximum, tunable later.

### Original options

- **D1 Final accuracy vs cost:** final = joined segments (billed ≈ T, a word can
  occasionally split at a forced 10 s cut) — **recommended** — or add one full-audio pass
  at stop for the final text (billed ≈ 2T, slower stop, best accuracy)?
- **D2 Segment bounds:** 3 s minimum / 350 ms pause / 10 s maximum as defaults to tune
  later — OK?

## 9. Sequencing note

The shared bottom input rework (in progress) is also changing `voice-input-button.svelte`
(mic amplitude inside the button). This change starts after that lands, to avoid two
edits to the same file.
