/**
 * Project detail view-mode enum + parser (shared client + server).
 * Pure deterministic contract validation for the `?view=` query param and
 * the localStorage view-mode preference — no LLM, no semantic string analysis.
 */

export type ProjectViewMode = 'list' | 'timeline' | 'kanban'

export function parseProjectViewMode(raw: string | null | undefined): ProjectViewMode {
  if (raw === 'list' || raw === 'timeline' || raw === 'kanban') return raw
  return 'list'
}
