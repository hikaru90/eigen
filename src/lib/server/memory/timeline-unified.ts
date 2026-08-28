import type { MemoryAuthor } from '$lib/server/db/brain.schema'
import { listProjects, type ProjectCatalogScope, type ProjectListItem } from '$lib/server/memory/project-list'
import {
  listTemporalEventsForUser,
  MAX_LIST_LIMIT,
  type TemporalEventListItem,
} from '$lib/server/memory/temporal-event-list'

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
  /** 'all' means every author; otherwise a coarse author filter for items. */
  author?: MemoryAuthor | 'all'
  authorLayerKey?: string | null
  orderBy?: 'ingest' | 'todo'
  sortDirection?: 'asc' | 'desc'
}

/** How the items query was scoped — drives the matching project-catalog scope. */
export type TimelineCatalogScope = ProjectCatalogScope

function catalogScopeForQuery(
  author: MemoryAuthor | 'all' | undefined,
  authorLayerKey: string | null | undefined,
): ProjectCatalogScope {
  if (authorLayerKey) return { kind: 'authorLayer', author: 'agent', authorLayerKey }
  if (author === 'all') return { kind: 'all' }
  if (author === 'agent') return { kind: 'authorLayer', author: 'agent', authorLayerKey: null }
  return { kind: 'user' }
}

/**
 * Single source of truth for Tasks + Projects surfaces.
 * Returns the full item set for the filters (no cursor) plus the project catalog
 * for the SAME author scope as the items — not just projects present on items.
 */
export async function loadUnifiedTimeline(
  query: TimelineUnifiedQuery,
): Promise<TimelineUnifiedResponse> {
  const { author, authorLayerKey } = query
  const itemsAuthor: MemoryAuthor | undefined = author === 'all' ? undefined : author
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
    author: itemsAuthor,
    authorLayerKey: query.authorLayerKey,
    orderBy: query.orderBy ?? 'ingest',
    sortDirection: query.sortDirection ?? 'desc',
    limit: MAX_LIST_LIMIT,
  })

  const projects = await listProjects(
    query.userId,
    catalogScopeForQuery(author, authorLayerKey),
  )
  return { items, projects }
}
