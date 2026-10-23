import { fetchEchoRows, type EchoRow } from '$lib/memory/echo-list'

/**
 * What an Ask memory card shows once expanded: the thought's full text and type from
 * the existing read endpoint (GET /api/thoughts/[thoughtId]) and its linked thoughts
 * from the same retrieval call the thought page uses for echoes. Loaded on the expand
 * click — never reactively — and display fields only (embeddings are DB-only).
 */
export type MemoryCardDetails = {
  text: string
  category: string | null
  linked: EchoRow[]
}

export function pickThoughtDetails(body: unknown, fallbackText: string): Omit<MemoryCardDetails, 'linked'> {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const normalized = typeof record.normalizedText === 'string' ? record.normalizedText.trim() : ''
  const raw = typeof record.rawText === 'string' ? record.rawText.trim() : ''
  const category = typeof record.category === 'string' && record.category.trim() ? record.category.trim() : null
  return { text: normalized || raw || fallbackText, category }
}

/** Throws on a failed read so the card can say so explicitly (no silent substitute). */
export async function loadMemoryCardDetails(
  id: string,
  fallbackText: string,
  signal?: AbortSignal,
): Promise<MemoryCardDetails> {
  const res = await fetch(`/api/thoughts/${encodeURIComponent(id)}`, {
    credentials: 'same-origin',
    signal,
  })
  if (!res.ok) throw new Error(`Thought read failed (${res.status})`)
  const details = pickThoughtDetails(await res.json(), fallbackText)
  const linked = await fetchEchoRows(details.text, id, signal)
  return { ...details, linked }
}
