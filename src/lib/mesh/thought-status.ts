/**
 * Thought status resolution for the Yarn tick — mirrors the unified timeline's
 * resolveThoughtLifecycleStatus (src/lib/server/memory/temporal-event-list.ts:
 * 240-243): the `lifecycle_status` column is authoritative; the legacy
 * `metadata.status` only fills in for rows that predate it. Unknown values are
 * `open` — never invented states, never silent divergence.
 */

export type ThoughtLifecycleStatus = 'open' | 'completed' | 'archived'

const LIFECYCLE_VALUES: ReadonlySet<string> = new Set(['open', 'completed', 'archived'])

export function effectiveLifecycleStatus(
  lifecycleStatus: string | null | undefined,
  metadataStatus: unknown,
): ThoughtLifecycleStatus {
  if (lifecycleStatus != null && LIFECYCLE_VALUES.has(lifecycleStatus)) {
    return lifecycleStatus as ThoughtLifecycleStatus
  }
  if (metadataStatus === 'completed' || metadataStatus === 'archived') {
    return metadataStatus
  }
  return 'open'
}

/**
 * Whether a thought's persisted category makes it a to-do, so the row carries
 * the tick ring. Rendering-only use of the LLM-decided category key — the same
 * signal the unified timeline already uses (temporal-event-list.ts:113,
 * isTaskListItem). The category itself is decided by the LLM at capture; no
 * string heuristic decides meaning here.
 */
export function isTodoCategory(category: string): boolean {
  return category === 'task'
}
