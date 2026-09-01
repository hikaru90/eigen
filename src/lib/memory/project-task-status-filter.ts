/**
 * Project detail task-status filter enum + parser (shared client + server).
 * Pure deterministic contract validation for the `?status=` query param —
 * no LLM, no semantic string analysis.
 */

export type ProjectTaskStatusFilter = 'open' | 'all'

export function parseProjectTaskStatusFilter(
  raw: string | null | undefined,
): ProjectTaskStatusFilter {
  if (raw === 'open' || raw === 'all') return raw
  return 'open'
}
