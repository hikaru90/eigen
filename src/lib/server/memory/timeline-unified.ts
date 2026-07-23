import {
  listTemporalEventsForUser,
  MAX_LIST_LIMIT,
  type TemporalEventListItem,
} from '$lib/server/memory/temporal-event-list'
import {
  listProjectsByEntityIds,
  type ProjectListItem,
} from '$lib/server/memory/project-list'
import type { MemoryAuthor } from '$lib/server/db/brain.schema'

export type TimelineUnifiedResponse = {
  items: TemporalEventListItem[]
  projects: ProjectListItem[]
}

export type TimelineUnifiedQuery = {
  userId: string
  from?: string | null
  to?: string | null
  /** Ignored — undated open tasks are always included. */
  includeUndated?: boolean
  author?: MemoryAuthor
  authorLayerKey?: string | null
  orderBy?: 'ingest' | 'todo'
  sortDirection?: 'asc' | 'desc'
}

/**
 * Single source of truth for Tasks + Projects surfaces.
 * Returns the full item set for the filters (no cursor) plus the project catalog
 * for projectEntityIds present on those items.
 */
export async function loadUnifiedTimeline(
  query: TimelineUnifiedQuery,
): Promise<TimelineUnifiedResponse> {
  const { items } = await listTemporalEventsForUser({
    userId: query.userId,
    status: 'all',
    includeTasks: true,
    // Always include undated open tasks — date range narrows dated events only.
    includeUndated: true,
    // Open dated tasks must survive dial presets (due date ≠ membership).
    alwaysIncludeOpen: true,
    from: query.from ?? null,
    to: query.to ?? null,
    author: query.author,
    authorLayerKey: query.authorLayerKey,
    orderBy: query.orderBy ?? 'ingest',
    sortDirection: query.sortDirection ?? 'desc',
    limit: MAX_LIST_LIMIT,
  })

  const projectEntityIds = [
    ...new Set(
      items
        .map((item) => item.projectEntityId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ]

  const projects = await listProjectsByEntityIds(query.userId, projectEntityIds)
  return { items, projects }
}
