/**
 * The up-front reading (ei redesign decision #3): while the user types, the mesh reads
 * the words (POST /api/capture/read — preview only, nothing persisted) and the page shows
 * "Sounds like <type> · <thread>". Pressing Capture keeps the accepted reading in ONE
 * call (POST /api/capture/keep). This module is the pure state mapping around that:
 * debounce thresholds, client-side validation of the read response, the client copy of
 * the accepted reading that the type menu mutates, freshness (the verbatim-invariant
 * guard for keep), display prettify of ontology keys, and the `#` hash editing
 * mechanics (ported from ei app.js:415-431 — editing gestures, not meaning decisions).
 */
import type {
  CapturePreviewBundle,
  CapturePreviewCategory,
  CapturePreviewEntity,
} from './confirmation-types'

/** ei app.js:336 — the pause that means "read it". */
export const READING_DEBOUNCE_MS = 600
/** ei app.js:327 — shorter input is still being formed; the mesh waits. */
export const READING_MIN_CHARS = 8

export type ReadingStatus = 'idle' | 'waiting'

/**
 * The reading as the client holds it: nothing is stored yet. `reading` is the user's
 * accepted copy of the preview bundle — the type menu edits it; keep persists it.
 */
export type ReadingDraft = {
  /** The exact trimmed raw text the server read (freshness anchor). */
  rawText: string
  /** The accepted reading (CapturePreviewBundle), sent verbatim to /api/capture/keep. */
  reading: CapturePreviewBundle
}

/** A chosen thread: loose (no thread), an existing project, or a new one by label. */
export type ThreadChoice =
  | { kind: 'loose' }
  | { kind: 'thread'; entityId?: string; label: string }

export function readingStatusFor(raw: string): ReadingStatus {
  return raw.trim().length >= READING_MIN_CHARS ? 'waiting' : 'idle'
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asConfidence(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null
}

function parsePreviewBundle(value: unknown): CapturePreviewBundle | null {
  const preview = asRecord(value)
  if (!preview) return null
  const interpretedText = asNonEmptyString(preview.interpretedText)
  if (!interpretedText) return null

  const category = asRecord(preview.category)
  if (!category) return null
  const key = asNonEmptyString(category.key)
  const confidence = asConfidence(category.confidence)
  if (!key || confidence === null) return null
  const alternatives: CapturePreviewCategory['alternatives'] = []
  for (const alt of Array.isArray(category.alternatives) ? category.alternatives : []) {
    const a = asRecord(alt)
    const altKey = a ? asNonEmptyString(a.key) : null
    const altConfidence = a ? asConfidence(a.confidence) : null
    if (altKey && altConfidence !== null) alternatives.push({ key: altKey, confidence: altConfidence })
  }

  if (!Array.isArray(preview.entities)) return null
  const entities: CapturePreviewEntity[] = []
  for (const ent of preview.entities) {
    const e = asRecord(ent)
    const surface = e ? asNonEmptyString(e.surface) : null
    const entityType = e ? asNonEmptyString(e.entityType) : null
    const entConfidence = e ? asConfidence(e.confidence) : null
    if (surface && entityType && entConfidence !== null) {
      entities.push({ surface, entityType, confidence: entConfidence })
    }
  }

  if (typeof preview.deviatesFromVerbatim !== 'boolean') return null

  return {
    interpretedText,
    category: { key, confidence, alternatives },
    entities,
    deviatesFromVerbatim: preview.deviatesFromVerbatim,
  }
}

/**
 * Validate the POST /api/capture/read response (`{ preview }`) into a ReadingDraft.
 * Returns null on any contract violation — callers surface an explicit error state;
 * no fallback reading is ever invented (repo failure policy).
 */
export function readingFromPreview(body: unknown, requestedRaw: string): ReadingDraft | null {
  const obj = asRecord(body)
  if (!obj) return null
  const reading = parsePreviewBundle(obj.preview)
  if (!reading) return null
  return { rawText: requestedRaw.trim(), reading }
}

/**
 * True only when the draft was read from exactly the current trimmed raw text.
 * Capture keeps a reading only when this holds — otherwise the typed words and the
 * reading's raw diverge and the verbatim invariant (raw_text = typed words) would break.
 */
export function isReadingFresh(draft: ReadingDraft | null, raw: string): boolean {
  return !!draft && draft.rawText === raw.trim()
}

/** The type menu's honest options: the LLM's primary key first, then its own alternatives. */
export function readingTypeKeys(draft: ReadingDraft): string[] {
  const keys = [draft.reading.category.key]
  for (const alt of draft.reading.category.alternatives) {
    if (!keys.includes(alt.key)) keys.push(alt.key)
  }
  return keys
}

/**
 * The user picks a type among the LLM's own options: the chosen key becomes the accepted
 * category and the previous primary joins the alternatives. Keys the LLM never offered
 * are refused (no new meaning is decided client-side). Returns the same draft when
 * nothing changes.
 */
export function withAcceptedType(draft: ReadingDraft, key: string): ReadingDraft {
  const current = draft.reading.category
  if (key === current.key) return draft
  const chosen = current.alternatives.find((a) => a.key === key)
  if (!chosen) return draft
  const alternatives = [
    { key: current.key, confidence: current.confidence },
    ...current.alternatives.filter((a) => a.key !== key),
  ]
  return {
    ...draft,
    reading: {
      ...draft.reading,
      category: { key: chosen.key, confidence: chosen.confidence, alternatives },
    },
  }
}

/**
 * Render-only prettify of an ontology category key ("task" → "Task").
 * Post-LLM code may format and render — it does not decide meaning here.
 */
export function categoryLabel(key: string): string {
  const t = key.trim().replace(/_+/g, ' ')
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t
}

/* ————— hash editing mechanics (ei app.js:415-431) ————— */

/** A trailing `#token` before the caret — the user is picking a thread inline. */
export const HASH_TOKEN = /(^|\s)#([\p{L}\p{N}-]*)$/u

/** The query after an inline `#` at the caret, or null when there is none. */
export function hashQueryAt(value: string, caret: number): string | null {
  if (caret < 0 || caret > value.length) return null
  const match = value.slice(0, caret).match(HASH_TOKEN)
  return match ? match[2] : null
}

/** ei stripHash — remove the `#token` before the caret once a thread is picked. */
export function stripHashAt(value: string, caret: number): { value: string; caret: number } {
  const before = value.slice(0, caret).replace(HASH_TOKEN, '$1')
  return { value: before + value.slice(caret), caret: before.length }
}

/** ei app.js:442 — an unconfirmed trailing `#token` is not words; drop it on submit. */
export function stripTrailingHash(value: string): string {
  return value.replace(/(^|\s)#[\p{L}\p{N}-]*\s*$/u, '$1').trim()
}
