import type {
  CaptureRecentThoughtSnippet,
  CaptureSubmitResult,
} from '$lib/capture/capture-result-types'

export function thoughtToRecentSnippet(
  thought: CaptureSubmitResult,
  existing?: CaptureRecentThoughtSnippet,
): CaptureRecentThoughtSnippet {
  return {
    id: thought.id,
    normalizedText: thought.normalizedText,
    category: thought.category,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    author: thought.author ?? existing?.author ?? 'user',
    authorLabel: thought.authorLabel ?? existing?.authorLabel ?? null,
    lifecycleStatus: thought.lifecycleStatus ?? existing?.lifecycleStatus ?? 'open',
  }
}

/** Update recent list without reordering unless pinToTop is set (new capture). */
export function upsertRecentThoughtList(
  existing: CaptureRecentThoughtSnippet[],
  thought: CaptureSubmitResult,
  options?: { pinToTop?: boolean; limit?: number },
): CaptureRecentThoughtSnippet[] {
  const limit = options?.limit ?? existing.length
  const prior = existing.find((row) => row.id === thought.id)
  const snippet = thoughtToRecentSnippet(thought, prior)

  if (prior && !options?.pinToTop) {
    return existing.map((row) => (row.id === thought.id ? snippet : row))
  }

  return [snippet, ...existing.filter((row) => row.id !== thought.id)].slice(0, limit)
}
