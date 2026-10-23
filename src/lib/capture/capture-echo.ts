/**
 * The echo under Capture (ei DESIGN: "A moment later an echo may surface: an older
 * thought this one rhymes with"). Fetched from the existing retrieval endpoint
 * (POST /api/retrieval/search — embeddings never appear client-side); only display
 * fields are read.
 */
import { stripTrailingHash } from './reading-state'

/** ei app.js:497 — the echo waits ~2s after the thought lands. */
export const ECHO_DELAY_MS = 2300

export type EchoPick = { thoughtId: string; text: string }

/**
 * Pick the first retrieval row that is not the captured thought itself.
 * Malformed rows are skipped; nothing is invented when the answer is empty.
 */
export function pickEcho(rows: unknown, excludeThoughtId: string): EchoPick | null {
  if (!Array.isArray(rows)) return null
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const record = row as Record<string, unknown>
    const id = record.id
    const text = record.normalizedText
    if (typeof id !== 'string' || !id.trim() || id === excludeThoughtId) continue
    if (typeof text !== 'string' || !text.trim()) continue
    return { thoughtId: id, text }
  }
  return null
}

/**
 * Ask the existing retrieval endpoint what rhymes with the captured thought.
 * A failed call surfaces no echo (the design says "may surface"); it never
 * substitutes a fake one. Only id/normalizedText are read from the response.
 */
export async function fetchEchoThought(
  query: string,
  excludeThoughtId: string,
  signal?: AbortSignal,
): Promise<EchoPick | null> {
  const q = stripTrailingHash(query)
  if (!q) return null
  const res = await fetch('/api/retrieval/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: q, topK: 4 }),
    credentials: 'same-origin',
    signal,
  })
  if (!res.ok) return null
  const body = (await res.json()) as { results?: unknown }
  return pickEcho(body?.results, excludeThoughtId)
}
