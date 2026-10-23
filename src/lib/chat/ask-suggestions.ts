/**
 * "Try asking" on Ask at rest: three outline pills in your voice (ei DESIGN.md
 * "Actions" / ".ask-suggestions"). The words are your own recent thoughts, fetched cheaply
 * from the existing `GET /api/capture/recent`; tapping one asks it back. Nothing here
 * decides what a thought *means* — this only tidies and shortens text for a pill.
 */
export type AskSuggestion = { id: string; text: string }

export type RecentThoughtLike = { id: string; normalizedText: string }

export const ASK_SUGGESTION_COUNT = 3

/** Pills stay one quiet line on a phone; longer thoughts end in a single ellipsis. */
export const ASK_SUGGESTION_MAX_CHARS = 72

function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function shorten(text: string, max: number): string {
  if (text.length <= max) return text
  const room = text.slice(0, max - 1)
  const lastSpace = room.lastIndexOf(' ')
  const kept = (lastSpace > 0 ? room.slice(0, lastSpace) : room).trimEnd()
  return `${kept}…`
}

export function suggestionsFromRecentThoughts(
  rows: ReadonlyArray<RecentThoughtLike>,
  opts: { count?: number; maxChars?: number } = {},
): AskSuggestion[] {
  const count = opts.count ?? ASK_SUGGESTION_COUNT
  const maxChars = opts.maxChars ?? ASK_SUGGESTION_MAX_CHARS
  const seen = new Set<string>()
  const out: AskSuggestion[] = []
  for (const row of rows) {
    if (out.length >= count) break
    const text = tidy(row.normalizedText ?? '')
    if (!text) continue
    const key = text.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ id: row.id, text: shorten(text, maxChars) })
  }
  return out
}
