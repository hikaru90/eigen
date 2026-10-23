/**
 * The thought page saves through the existing edit endpoint — POST /api/capture/edit
 * with `{ thoughtId, editRequest }` (src/routes/api/capture/edit/+server.ts:25-30) — a
 * natural-language request the server applies with an LLM
 * (src/lib/server/capture/apply-thought-edit.ts). These helpers only compose that
 * request from what the user chose; no meaning is decided here.
 */

/** The new words when they differ from the stored ones and are not blank; else null. */
export function textChange(current: string, next: string): string | null {
  const value = next.trim()
  if (!value || value === current.trim()) return null
  return value
}

/** The pencil: say the words in place — the stored thought becomes exactly these words. */
export function replaceTextEditRequest(newText: string): string {
  return `Replace the thought's text with exactly the following words, changing nothing else:\n\n${newText}`
}

/** The type control: keep the thought as the chosen type without touching the words. */
export function typeEditRequest(typeName: string): string {
  return `Keep this thought as: ${typeName}. Keep the words exactly as they are.`
}
