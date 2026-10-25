import { TranscribeRequestError } from './transcribe-audio'

/**
 * Segmented speech-to-text (docs/planning/feature-segmented-stt.md).
 *
 * The voice button records independent segments on one MediaStream, cutting at
 * pauses detected from the mic level (signal processing, not text analysis).
 * Each segment is transcribed exactly once; the transcript is the ordered join
 * of segment transcripts (D1). Joining with single spaces is formatting only.
 */

/** D2: a segment is never cut on a pause before it is this long. */
export const SEGMENT_MIN_MS = 3000
/** D2: silence this long (after the minimum) ends a segment. */
export const SEGMENT_PAUSE_MS = 350
/** D2: a segment is force-cut at this length when no pause comes. */
export const SEGMENT_MAX_MS = 10_000
/** Mic level (0–1, see {@link micLevelFromSamples}) below which a frame counts as silence. */
export const SILENCE_LEVEL = 0.05
/**
 * Voiced time (frames at or above {@link SILENCE_LEVEL}) that makes a segment speech.
 * A breath, a click or a bump is a frame or two; a spoken word is longer.
 */
export const MIN_SPEECH_MS = 300
/**
 * A segment too short to reach {@link MIN_SPEECH_MS} (the tail you stop right after a
 * forced cut) is speech when at least this share of its readings is voiced — so the
 * last words are never dropped, while a click in a pause stays silence.
 */
export const MIN_VOICED_SHARE = 0.5
export const SEGMENT_FAILED_MESSAGE = "Couldn't transcribe part of your recording — try again"

/** RMS of 8-bit time-domain samples, scaled to 0–1 (same scale the level meter shows). */
export function micLevelFromSamples(samples: Uint8Array): number {
  let sumSq = 0
  for (const sample of samples) {
    const normalized = (sample - 128) / 128
    sumSq += normalized * normalized
  }
  return Math.min(1, Math.sqrt(sumSq / samples.length) * 4)
}

export type SilenceCutter = {
  /** Feed one level reading; returns true when the current segment should end now. */
  feed(level: number, nowMs: number): boolean
  /**
   * Whether the segment is speech: at least {@link MIN_SPEECH_MS} of voiced time, or —
   * for a segment too short for that — mostly voiced readings ({@link MIN_VOICED_SHARE}).
   * A segment that is not is never uploaded: ASR models invent text (other languages,
   * stock phrases) on silent audio, and one loud frame (a breath, a click) in a pause is
   * still silence.
   */
  heardSpeech(): boolean
  /** A new segment started at `nowMs`. */
  restart(nowMs: number): void
}

export function createSilenceCutter(startMs: number): SilenceCutter {
  let segmentStart = startMs
  let silenceSince: number | null = null
  let lastFeedMs = startMs
  let voicedMs = 0
  let readings = 0
  let voicedReadings = 0
  return {
    feed(level, nowMs) {
      readings += 1
      // a voiced reading counts for the time since the previous reading
      if (level >= SILENCE_LEVEL) {
        voicedReadings += 1
        voicedMs += Math.max(0, nowMs - lastFeedMs)
      }
      lastFeedMs = nowMs
      const elapsed = nowMs - segmentStart
      if (elapsed >= SEGMENT_MAX_MS) return true
      if (level >= SILENCE_LEVEL) {
        silenceSince = null
        return false
      }
      silenceSince ??= nowMs
      return elapsed >= SEGMENT_MIN_MS && nowMs - silenceSince >= SEGMENT_PAUSE_MS
    },
    heardSpeech() {
      if (voicedMs >= MIN_SPEECH_MS) return true
      const span = lastFeedMs - segmentStart
      // only a segment shorter than the threshold may pass on its share of voiced readings
      return span < MIN_SPEECH_MS && voicedReadings > 0 && voicedReadings / readings >= MIN_VOICED_SHARE
    },
    restart(nowMs) {
      segmentStart = nowMs
      silenceSince = null
      lastFeedMs = nowMs
      voicedMs = 0
      readings = 0
      voicedReadings = 0
    },
  }
}

export type SegmentTranscriberOptions = {
  transcribe: (segment: Blob, index: number, signal: AbortSignal) => Promise<string>
  /** Running transcript: ordered join of the contiguous transcribed prefix. */
  onPartial: (text: string) => void
  /**
   * Called once when a segment fails. The client makes one request per segment: the
   * server already retries the OpenRouter call exactly 3 times (llmCreateTranscription),
   * so a failed response here is final.
   */
  onFatal: (message: string) => void
}

export type SegmentTranscriber = {
  submit(index: number, segment: Blob): void
  /** Records a silent segment as empty without transcribing it, so the order stays intact. */
  skip(index: number): void
  /** Waits for every submitted segment; resolves to the joined transcript or rejects with the fatal error. */
  finish(): Promise<string>
  /** Cancels in-flight requests without reporting an error. */
  abort(): void
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

export function createSegmentTranscriber(options: SegmentTranscriberOptions): SegmentTranscriber {
  const controller = new AbortController()
  const results = new Map<number, string>()
  const pending = new Map<number, Promise<void>>()
  let fatal: Error | null = null
  let shownCount = 0

  function joinUpTo(count: number): string {
    const parts: string[] = []
    for (let i = 0; i < count; i++) {
      const text = results.get(i)?.trim()
      if (text) parts.push(text)
    }
    return parts.join(' ')
  }

  function emitPartial() {
    let contiguous = shownCount
    while (results.has(contiguous)) contiguous++
    if (contiguous === shownCount) return
    shownCount = contiguous
    options.onPartial(joinUpTo(contiguous))
  }

  function fail(message: string) {
    if (fatal) return
    fatal = new Error(message)
    controller.abort()
    options.onFatal(message)
  }

  async function run(index: number, segment: Blob): Promise<void> {
    if (controller.signal.aborted) return
    try {
      const text = await options.transcribe(segment, index, controller.signal)
      if (controller.signal.aborted) return
      results.set(index, text)
      emitPartial()
    } catch (err) {
      if (controller.signal.aborted || isAbort(err)) return
      if (err instanceof TranscribeRequestError && err.status === 402) {
        fail(err.message)
        return
      }
      console.error('segment transcription failed', { index, err })
      fail(SEGMENT_FAILED_MESSAGE)
    }
  }

  return {
    submit(index, segment) {
      if (pending.has(index)) throw new Error(`segment ${index} was already submitted`)
      if (controller.signal.aborted) return
      pending.set(index, run(index, segment))
    },
    skip(index) {
      if (pending.has(index)) throw new Error(`segment ${index} was already submitted`)
      if (controller.signal.aborted) return
      pending.set(index, Promise.resolve())
      results.set(index, '')
      emitPartial()
    },
    async finish() {
      await Promise.all(pending.values())
      if (fatal) throw fatal
      return joinUpTo(Math.max(-1, ...pending.keys()) + 1)
    },
    abort() {
      controller.abort()
    },
  }
}
