/**
 * "Ask what connects to this" (ei app.js:1472 `askFrom(...)`). Ask has no prompt deep
 * link today (src/routes/chat/+page.svelte reads only `mode` and `period`), but it
 * seeds its writer from `pageInputDrafts.chat` (chat/+page.svelte:78), so the thought
 * page writes the draft there and carries the thought id as `?thought=` for Ask to
 * pick up later.
 */

/** ei app.js:1472 — the first six words stand for the thought. */
export const EXCERPT_WORDS = 6

export function excerptWords(text: string, max = EXCERPT_WORDS): string {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length <= max) return words.join(' ')
  return `${words.slice(0, max).join(' ')}…`
}

/** What lands in Ask's writer: the thought's first words, quoted — your voice. */
export function askDraftFor(text: string): string {
  return `“${excerptWords(text)}”`
}

export function askHrefFor(thoughtId: string): string {
  return `/chat?thought=${encodeURIComponent(thoughtId)}`
}
