/**
 * The list search's matcher (ei redesign, wave 2.2) — a direct port of ei
 * app.js:1861-1872: plain substring on a row's visible text, lowercased.
 * This is *filtering*, not semantic classification — the repo guardrails
 * allow exactly this (docs/planning/ei-redesign.md). Nothing here routes,
 * classifies or interprets; it only decides which rows stay on screen.
 */

/** Trim + lowercase what was typed. Empty stays empty (matches everything). */
export function normalizeQuery(raw: string): string {
  return raw.trim().toLowerCase()
}

/**
 * ei app.js:1869 — a row matches while the query is empty; otherwise its
 * visible text must contain the query.
 */
export function rowMatchesQuery(visibleText: string, query: string): boolean {
  const q = normalizeQuery(query)
  if (!q) return true
  return visibleText.toLowerCase().includes(q)
}
