import type {
  CaptureRecentThoughtSnippet,
  CaptureSubmitResult,
} from '$lib/capture/capture-result-types'
import { loadThoughtCaptureResult } from '$lib/server/capture/capture-result'
import { listThoughts } from '$lib/server/capture/service'
import type { MemoryAuthor } from '$lib/server/db/schema'

export const RECENT_CAPTURE_THOUGHTS_LIMIT = 8

export type RecentCaptureThoughtsPayload = {
  recentThoughts: CaptureRecentThoughtSnippet[]
  recentThoughtDetails: CaptureSubmitResult[]
}

export type RecentCaptureFilter = {
  author?: MemoryAuthor
  authorLayerKey?: string | null
  category?: string
  dateFrom?: Date
  dateTo?: Date
}

/** Recent capture list for the capture page and its refresh API. */
export async function loadRecentCaptureThoughts(
  userId: string,
  limit = RECENT_CAPTURE_THOUGHTS_LIMIT,
  filter?: RecentCaptureFilter,
): Promise<RecentCaptureThoughtsPayload> {
  const recentRows = await listThoughts(userId, {
    fields: 'snippet',
    limit,
    authorFilter: filter?.author,
    authorLayerKey: filter?.authorLayerKey,
    categoryFilter: filter?.category,
    dateFrom: filter?.dateFrom,
    dateTo: filter?.dateTo,
  })
  const recentThoughtDetails = await Promise.all(
    recentRows.map((row) => loadThoughtCaptureResult(userId, row.id)),
  )
  return {
    recentThoughts: recentRows.map((row) => ({
      id: row.id,
      normalizedText: row.normalizedText,
      category: row.category,
      createdAt: row.createdAt.toISOString(),
      author: row.author ?? 'user',
      authorLabel: row.authorLabel ?? null,
      lifecycleStatus: row.lifecycleStatus,
    })),
    recentThoughtDetails,
  }
}
