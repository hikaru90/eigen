/**
 * ECHOES on the thought page (ei DESIGN.md "A thought, up close": its echoes; ei
 * app.js:1334 renders `echoesOf(t, 3)`). The rows come from the existing retrieval
 * endpoint — POST /api/retrieval/search, the same call Capture's echo makes
 * (src/lib/capture/capture-echo.ts) — and only display fields are read. Embeddings are
 * DB-only and never part of the payload this module touches.
 */

/** ei app.js:1326 — three echoes at most. */
export const ECHO_LIMIT = 3
/** One extra so the thought itself can be dropped from its own neighbourhood. */
export const ECHO_TOP_K = ECHO_LIMIT + 1

export type EchoRow = {
  id: string
  text: string
  /** ISO timestamp when the row carried a readable `createdAt`; null otherwise. */
  createdAtIso: string | null
}

function isoOf(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    return Number.isNaN(ms) ? null : new Date(ms).toISOString()
  }
  return null
}

/**
 * Keep the first `max` well-formed retrieval rows that are not the thought itself.
 * Malformed rows are skipped; nothing is invented when the answer is empty.
 */
export function pickEchoRows(rows: unknown, excludeThoughtId: string, max = ECHO_LIMIT): EchoRow[] {
  if (!Array.isArray(rows)) return []
  const out: EchoRow[] = []
  for (const row of rows) {
    if (out.length >= max) break
    if (!row || typeof row !== 'object') continue
    const record = row as Record<string, unknown>
    const id = record.id
    const text = record.normalizedText
    if (typeof id !== 'string' || !id.trim() || id === excludeThoughtId) continue
    if (typeof text !== 'string' || !text.trim()) continue
    out.push({ id, text, createdAtIso: isoOf(record.createdAt) })
  }
  return out
}

/**
 * Ask the existing retrieval endpoint what rhymes with this thought. A failed call
 * surfaces no echoes (the design says an echo "may surface"); it never substitutes.
 */
export async function fetchEchoRows(
  query: string,
  excludeThoughtId: string,
  signal?: AbortSignal,
): Promise<EchoRow[]> {
  const q = query.trim()
  if (!q) return []
  const res = await fetch('/api/retrieval/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: q, topK: ECHO_TOP_K }),
    credentials: 'same-origin',
    signal,
  })
  if (!res.ok) return []
  const body = (await res.json()) as { results?: unknown }
  return pickEchoRows(body?.results, excludeThoughtId)
}
