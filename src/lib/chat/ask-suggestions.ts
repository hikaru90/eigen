/**
 * "Try asking" on Ask at rest: up to three pills, each the question enrichment stored for
 * one of your recent thoughts (docs/planning/feature-ask-suggested-questions.md). Tapping
 * one asks it. Nothing here decides meaning — it only orders, dedupes and caps.
 */
export type AskSuggestion = { thoughtId: string; question: string }

export const ASK_SUGGESTION_COUNT = 3

function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Rows newest first; identical questions (after whitespace normalisation) appear once. */
export function pickAskSuggestions(
  rows: ReadonlyArray<{ thoughtId: string; question: string | null }>,
): AskSuggestion[] {
  const seen = new Set<string>()
  const out: AskSuggestion[] = []
  for (const row of rows) {
    if (out.length >= ASK_SUGGESTION_COUNT) break
    const question = tidy(row.question ?? '')
    if (!question || seen.has(question)) continue
    seen.add(question)
    out.push({ thoughtId: row.thoughtId, question })
  }
  return out
}
