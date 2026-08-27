import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  isNotNull,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import {
  RELEVANT_LOOKAHEAD_DAYS as SHARED_RELEVANT_LOOKAHEAD_DAYS,
  type AbsoluteDateRange,
} from '$lib/memory/timeline-date-range'
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import type {
  LifecycleStatus,
  MemoryAuthor,
  TemporalEnergyLevel,
  TemporalEventKind,
  TemporalPriorityQuadrant,
} from '$lib/server/db/brain.schema'
import { canonicalEntity, temporalEvent, thought, thoughtEntity } from '$lib/server/db/schema'
import { resolveAuthorSqlCondition } from '$lib/server/memory/authorship'
import { computeFocusRank } from '$lib/server/memory/compute-focus-rank'

export const TASK_ITEM_PREFIX = 'task:'

/** Bare-thought-UUID lookup (capture page): rows without a temporal_event. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** @deprecated Legacy timeline IDs — still accepted when parsing. */
export const LEGACY_OPEN_LOOP_ITEM_PREFIX = 'open-loop:'

export const RELEVANT_LOOKAHEAD_DAYS = SHARED_RELEVANT_LOOKAHEAD_DAYS
export const DEFAULT_LIST_LIMIT = 200
export const MAX_LIST_LIMIT = 500

export type TimelineItemType = 'event' | 'task'

export type TemporalEventListItem = {
  id: string
  itemType: TimelineItemType
  kind: string
  semanticSummary: string
  sourceTextSpan: string | null
  timePrecision: string
  timezone: string
  isAllDay: boolean
  confidence: number
  startAt: string | null
  endAt: string | null
  activePeriod: string
  graphSyncStatus: string
  graphSyncError: string | null
  lifecycleStatus: LifecycleStatus
  snoozedUntil: string | null
  recurrenceRule: string | null
  durationMinutes: number | null
  energyLevel: TemporalEnergyLevel | null
  priorityQuadrant: TemporalPriorityQuadrant | null
  contextTags: string[]
  focusRank: number | null
  parentEventId: string | null
  thoughtId: string
  thoughtText: string
  thoughtCategory: string
  thoughtStatus: LifecycleStatus
  projectLabel: string | null
  projectEntityId: string | null
  completedAt: string | null
  lifecycleUpdatedAt: string | null
  createdAt: string
  author: MemoryAuthor
  authorLabel: string | null
}

export type TemporalEventListQuery = {
  userId: string
  /** @deprecated Prefer from/to absolute bounds. Kept for overdue helpers / legacy callers. */
  range?: 'relevant' | 'upcoming' | 'past' | 'all'
  status?: 'open' | 'all'
  kinds?: string[]
  includeTasks?: boolean
  limit?: number
  cursorStartAt?: string | null
  cursorId?: string | null
  orderBy?: 'ingest' | 'todo'
  sortDirection?: 'asc' | 'desc'
  author?: MemoryAuthor
  authorLayerKey?: string | null
  /** Absolute lower bound (ISO). When set with `to` / alone, overrides enum `range`. */
  from?: string | null
  /** Absolute upper bound (ISO). */
  to?: string | null
  /** Include undated task thoughts when merging tasks. Default true when from/to used. */
  includeUndated?: boolean
  /**
   * When absolute from/to are set, still return every open temporal_event row.
   * Used by the Tasks/Projects unified timeline so due dates outside the dial
   * window do not hide open work.
   */
  alwaysIncludeOpen?: boolean
}

export function isTaskListItem(item: TemporalEventListItem): boolean {
  if (item.thoughtCategory === 'task') return true
  const itemType = item.itemType as string
  return (
    itemType === 'task' ||
    itemType === 'open_loop' ||
    item.id.startsWith(TASK_ITEM_PREFIX) ||
    item.id.startsWith(LEGACY_OPEN_LOOP_ITEM_PREFIX)
  )
}

export function taskItemId(thoughtId: string): string {
  return `${TASK_ITEM_PREFIX}${thoughtId}`
}

/**
 * Resolve a single thought (any category) into a task-shaped list item.
 * Capture-page rows are bare thought uuids without a temporal_event row;
 * this lets lifecycle quick actions target them through the shared
 * `POST /api/temporal-events/:id/action` path.
 */
export async function getThoughtListItemById(
  userId: string,
  thoughtId: string,
): Promise<TemporalEventListItem | null> {
  const [row] = await getDb()
    .select({
      id: thought.id,
      normalizedText: thought.normalizedText,
      normalizedTextEncrypted: thought.normalizedTextEncrypted,
      category: thought.category,
      metadata: thought.metadata,
      metadataEncrypted: thought.metadataEncrypted,
      lifecycleStatus: thought.lifecycleStatus,
      lifecycleUpdatedAt: thought.lifecycleUpdatedAt,
      lifecycleCompletedAt: thought.lifecycleCompletedAt,
      createdAt: thought.createdAt,
      updatedAt: thought.updatedAt,
      author: thought.author,
      authorLabel: thought.authorLabel,
    })
    .from(thought)
    .where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))
    .limit(1)
  if (!row) return null

  const [thoughtText, metadataJson] = await Promise.all([
    row.normalizedTextEncrypted
      ? decryptTenantValue({
          userId,
          table: 'thought',
          column: 'normalized_text',
          ciphertext: row.normalizedTextEncrypted,
        })
      : Promise.resolve(row.normalizedText),
    row.metadataEncrypted
      ? decryptTenantValue({
          userId,
          table: 'thought',
          column: 'metadata',
          ciphertext: row.metadataEncrypted,
        })
      : Promise.resolve(JSON.stringify(row.metadata ?? {})),
  ])
  const metadata = JSON.parse(metadataJson) as Record<string, unknown>
  const thoughtStatus = thoughtLifecycleFromRow({
    lifecycleStatus: row.lifecycleStatus,
    metadata,
  })
  const completedAt = completedAtFromThought({
    lifecycleCompletedAt: row.lifecycleCompletedAt,
    metadata,
  })
  const summary =
    thoughtText.length > 120 ? `${thoughtText.slice(0, 117).trim()}…` : thoughtText.trim()

  return {
    id: taskItemId(row.id),
    itemType: 'task',
    kind: 'reminder',
    semanticSummary: summary,
    sourceTextSpan: null,
    timePrecision: 'fuzzy',
    timezone: 'UTC',
    isAllDay: false,
    confidence: 1,
    startAt: null,
    endAt: null,
    activePeriod: '',
    graphSyncStatus: 'n/a',
    graphSyncError: null,
    lifecycleStatus: thoughtStatus,
    snoozedUntil: null,
    recurrenceRule: null,
    durationMinutes: null,
    energyLevel: null,
    priorityQuadrant: null,
    contextTags: [],
    focusRank: null,
    parentEventId: null,
    thoughtId: row.id,
    thoughtText,
    thoughtCategory: row.category,
    thoughtStatus,
    projectLabel: null,
    projectEntityId: null,
    completedAt,
    lifecycleUpdatedAt: (row.lifecycleUpdatedAt ?? row.updatedAt).toISOString(),
    createdAt: row.createdAt.toISOString(),
    author: row.author,
    authorLabel: row.authorLabel,
  }
}

export function thoughtIdFromTaskItemId(itemId: string): string | null {
  if (itemId.startsWith(TASK_ITEM_PREFIX)) {
    return itemId.slice(TASK_ITEM_PREFIX.length)
  }
  if (itemId.startsWith(LEGACY_OPEN_LOOP_ITEM_PREFIX)) {
    return itemId.slice(LEGACY_OPEN_LOOP_ITEM_PREFIX.length)
  }
  return null
}

function thoughtLifecycleFromRow(input: {
  lifecycleStatus: LifecycleStatus | null
  metadata: Record<string, unknown>
}): LifecycleStatus {
  if (input.lifecycleStatus) return input.lifecycleStatus
  if (input.metadata.status === 'completed') return 'completed'
  if (input.metadata.status === 'archived') return 'archived'
  return 'open'
}

function completedAtFromThought(input: {
  lifecycleCompletedAt: Date | null
  metadata: Record<string, unknown>
}): string | null {
  if (input.lifecycleCompletedAt) return input.lifecycleCompletedAt.toISOString()
  const raw = input.metadata.completedAt
  return typeof raw === 'string' && raw.trim() ? raw : null
}

async function loadProjectLinksByThoughtId(
  userId: string,
  thoughtIds: string[],
): Promise<Map<string, { label: string; entityId: string }>> {
  if (thoughtIds.length === 0) return new Map()

  const rows = await getDb()
    .select({
      thoughtId: thoughtEntity.thoughtId,
      entityId: canonicalEntity.id,
      label: canonicalEntity.label,
      salience: thoughtEntity.salience,
    })
    .from(thoughtEntity)
    .innerJoin(canonicalEntity, eq(thoughtEntity.entityId, canonicalEntity.id))
    .where(
      and(
        eq(thoughtEntity.userId, userId),
        inArray(thoughtEntity.thoughtId, thoughtIds),
        isNotNull(canonicalEntity.projectStatus),
      ),
    )
    .orderBy(desc(thoughtEntity.salience))

  const map = new Map<string, { label: string; entityId: string }>()
  for (const row of rows) {
    if (!map.has(row.thoughtId)) {
      map.set(row.thoughtId, { label: row.label, entityId: row.entityId })
    }
  }
  return map
}

function attachProjectLinks(
  items: TemporalEventListItem[],
  links: Map<string, { label: string; entityId: string }>,
): TemporalEventListItem[] {
  return items.map((item) => {
    const link = links.get(item.thoughtId)
    return {
      ...item,
      projectLabel: link?.label ?? null,
      projectEntityId: link?.entityId ?? null,
    }
  })
}

function rangeCondition(range: TemporalEventListQuery['range'], now: Date): SQL | undefined {
  if (!range || range === 'all') return undefined
  const nowIso = now.toISOString()
  const lookahead = new Date(now.getTime() + RELEVANT_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000)
  if (range === 'past') {
    return lt(sql`coalesce(${temporalEvent.startAt}, ${temporalEvent.createdAt})`, nowIso)
  }
  if (range === 'upcoming') {
    return gte(
      sql`coalesce(${temporalEvent.endAt}, ${temporalEvent.startAt}, ${temporalEvent.createdAt})`,
      nowIso,
    )
  }
  return or(
    gte(sql`coalesce(${temporalEvent.endAt}, ${temporalEvent.startAt})`, nowIso),
    and(gte(temporalEvent.startAt, now), lte(temporalEvent.startAt, lookahead)),
  )
}

/** Absolute [from, to] overlap on coalesce(start/end/created). Exported for unit tests. */
export function absoluteRangeCondition(range: AbsoluteDateRange): SQL | undefined {
  if (!range.from && !range.to) return undefined

  const startExpr = sql`coalesce(${temporalEvent.startAt}, ${temporalEvent.endAt}, ${temporalEvent.createdAt})`
  const endExpr = sql`coalesce(${temporalEvent.endAt}, ${temporalEvent.startAt}, ${temporalEvent.createdAt})`
  const parts: SQL[] = []
  if (range.from) {
    parts.push(gte(endExpr, range.from))
  }
  if (range.to) {
    parts.push(lte(startExpr, range.to))
  }
  return parts.length === 1 ? parts[0] : and(...parts)
}

function hasAbsoluteBounds(query: TemporalEventListQuery): boolean {
  return query.from != null || query.to != null
}

/**
 * Absolute mode when `from`/`to` are present on the query object — including
 * All time (`null`/`null`). Missing keys fall back to legacy enum `range`.
 */
export function usesAbsoluteDateFilter(query: TemporalEventListQuery): boolean {
  return query.from !== undefined || query.to !== undefined
}

async function listTaskThoughtsForUser(
  userId: string,
  status: TemporalEventListQuery['status'],
  _orderBy: TemporalEventListQuery['orderBy'] = 'ingest',
  sortDirection: TemporalEventListQuery['sortDirection'] = 'desc',
  authorFilter?: { author?: MemoryAuthor; authorLayerKey?: string | null },
): Promise<TemporalEventListItem[]> {
  // Anti-join: tasks with no temporal_event row — avoids unbounded thoughtId preload.
  const conditions: SQL[] = [
    eq(thought.userId, userId),
    eq(thought.category, 'task'),
    isNull(temporalEvent.id),
  ]
  const authorSql = resolveAuthorSqlCondition(
    {
      author: thought.author,
      authorKeyId: thought.authorKeyId,
      authorLabel: thought.authorLabel,
    },
    authorFilter ?? {},
  )
  if (authorSql) {
    conditions.push(authorSql)
  }
  if (status === 'open') {
    conditions.push(eq(thought.lifecycleStatus, 'open'))
  }

  const rows = await getDb()
    .select({
      id: thought.id,
      normalizedText: thought.normalizedText,
      normalizedTextEncrypted: thought.normalizedTextEncrypted,
      category: thought.category,
      metadata: thought.metadata,
      metadataEncrypted: thought.metadataEncrypted,
      lifecycleStatus: thought.lifecycleStatus,
      lifecycleUpdatedAt: thought.lifecycleUpdatedAt,
      lifecycleCompletedAt: thought.lifecycleCompletedAt,
      createdAt: thought.createdAt,
      updatedAt: thought.updatedAt,
      author: thought.author,
      authorLabel: thought.authorLabel,
    })
    .from(thought)
    .leftJoin(
      temporalEvent,
      and(eq(temporalEvent.thoughtId, thought.id), eq(temporalEvent.userId, userId)),
    )
    .where(and(...conditions))
    .orderBy(
      sortDirection === 'asc' ? asc(thought.createdAt) : desc(thought.createdAt),
      sortDirection === 'asc' ? asc(thought.id) : desc(thought.id),
    )
    .limit(100)

  const items: TemporalEventListItem[] = []
  for (const r of rows) {
    const [thoughtText, metadataJson] = await Promise.all([
      r.normalizedTextEncrypted
        ? decryptTenantValue({
            userId,
            table: 'thought',
            column: 'normalized_text',
            ciphertext: r.normalizedTextEncrypted,
          })
        : Promise.resolve(r.normalizedText),
      r.metadataEncrypted
        ? decryptTenantValue({
            userId,
            table: 'thought',
            column: 'metadata',
            ciphertext: r.metadataEncrypted,
          })
        : Promise.resolve(JSON.stringify(r.metadata ?? {})),
    ])
    const metadata = JSON.parse(metadataJson) as Record<string, unknown>
    const thoughtStatus = thoughtLifecycleFromRow({
      lifecycleStatus: r.lifecycleStatus,
      metadata,
    })
    if (status === 'open' && thoughtStatus !== 'open') continue
    const completedAt = completedAtFromThought({
      lifecycleCompletedAt: r.lifecycleCompletedAt,
      metadata,
    })

    const summary =
      thoughtText.length > 120 ? `${thoughtText.slice(0, 117).trim()}…` : thoughtText.trim()

    items.push({
      id: taskItemId(r.id),
      itemType: 'task',
      kind: 'reminder',
      semanticSummary: summary,
      sourceTextSpan: null,
      timePrecision: 'fuzzy',
      timezone: 'UTC',
      isAllDay: false,
      confidence: 1,
      startAt: null,
      endAt: null,
      activePeriod: '',
      graphSyncStatus: 'n/a',
      graphSyncError: null,
      lifecycleStatus: thoughtStatus,
      snoozedUntil: null,
      recurrenceRule: null,
      durationMinutes: null,
      energyLevel: null,
      priorityQuadrant: null,
      contextTags: [],
      focusRank: null,
      parentEventId: null,
      thoughtId: r.id,
      thoughtText,
      thoughtCategory: r.category,
      thoughtStatus,
      projectLabel: null,
      projectEntityId: null,
      completedAt,
      lifecycleUpdatedAt: (r.lifecycleUpdatedAt ?? r.updatedAt).toISOString(),
      createdAt: r.createdAt.toISOString(),
      author: r.author,
      authorLabel: r.authorLabel,
    })
  }
  return items
}

function mapEventRow(r: {
  id: string
  kind: string
  semanticSummary: string
  sourceTextSpan: string | null
  timePrecision: string
  timezone: string
  isAllDay: boolean
  confidence: number
  startAt: Date | null
  endAt: Date | null
  activePeriod: unknown
  graphSyncStatus: string
  graphSyncError: string | null
  lifecycleStatus: LifecycleStatus
  snoozedUntil: Date | null
  recurrenceRule: string | null
  durationMinutes: number | null
  energyLevel: TemporalEnergyLevel | null
  priorityQuadrant: TemporalPriorityQuadrant | null
  contextTags: string[] | null
  focusRank: number | null
  parentEventId: string | null
  thoughtId: string
  thoughtText: string
  thoughtCategory: string
  thoughtStatus: LifecycleStatus
  completedAt: string | null
  lifecycleUpdatedAt: Date | null
  createdAt: Date
  author: MemoryAuthor
  authorLabel: string | null
}): TemporalEventListItem {
  return {
    id: r.id,
    itemType: 'event',
    kind: r.kind,
    semanticSummary: r.semanticSummary,
    sourceTextSpan: r.sourceTextSpan,
    timePrecision: r.timePrecision,
    timezone: r.timezone,
    isAllDay: r.isAllDay,
    confidence: r.confidence,
    startAt: r.startAt?.toISOString() ?? null,
    endAt: r.endAt?.toISOString() ?? null,
    activePeriod: String(r.activePeriod),
    graphSyncStatus: r.graphSyncStatus,
    graphSyncError: r.graphSyncError,
    lifecycleStatus: r.lifecycleStatus,
    snoozedUntil: r.snoozedUntil?.toISOString() ?? null,
    recurrenceRule: r.recurrenceRule,
    durationMinutes: r.durationMinutes,
    energyLevel: r.energyLevel,
    priorityQuadrant: r.priorityQuadrant,
    contextTags: r.contextTags ?? [],
    focusRank: r.focusRank,
    parentEventId: r.parentEventId,
    thoughtId: r.thoughtId,
    thoughtText: r.thoughtText,
    thoughtCategory: r.thoughtCategory,
    thoughtStatus: r.thoughtStatus,
    projectEntityId: null,
    projectLabel: null,
    completedAt: r.completedAt,
    lifecycleUpdatedAt: r.lifecycleUpdatedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    author: r.author,
    authorLabel: r.authorLabel,
  }
}

export async function listTemporalEventsForUser(
  query: TemporalEventListQuery,
): Promise<{ items: TemporalEventListItem[]; nextCursor: { startAt: string; id: string } | null }> {
  const now = new Date()
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT)
  const conditions: SQL[] = [eq(temporalEvent.userId, query.userId)]

  if (query.status === 'open') {
    conditions.push(eq(temporalEvent.lifecycleStatus, 'open'))
  }

  const authorSql = resolveAuthorSqlCondition(
    {
      author: thought.author,
      authorKeyId: thought.authorKeyId,
      authorLabel: thought.authorLabel,
    },
    { author: query.author, authorLayerKey: query.authorLayerKey },
  )
  if (authorSql) {
    conditions.push(authorSql)
  }

  const kinds = query.kinds?.filter((k) => k.trim()) as TemporalEventKind[] | undefined
  if (kinds && kinds.length > 0) {
    conditions.push(inArray(temporalEvent.kind, kinds))
  }

  if (usesAbsoluteDateFilter(query)) {
    const absSql = absoluteRangeCondition({
      from: query.from ?? null,
      to: query.to ?? null,
      includeUndated: query.includeUndated ?? true,
    })
    if (absSql) {
      if (query.alwaysIncludeOpen) {
        conditions.push(or(absSql, eq(temporalEvent.lifecycleStatus, 'open'))!)
      } else {
        conditions.push(absSql)
      }
    }
    // from=null & to=null (All time): no date predicate — unbounded.
  } else {
    const rangeSql = rangeCondition(query.range ?? 'relevant', now)
    if (rangeSql) conditions.push(rangeSql)
  }

  if (query.cursorStartAt && query.cursorId) {
    const cursorStart = new Date(query.cursorStartAt)
    conditions.push(
      or(
        lt(temporalEvent.startAt, cursorStart),
        and(eq(temporalEvent.startAt, cursorStart), lt(temporalEvent.id, query.cursorId)),
      )!,
    )
  }

  const rows = await getDb()
    .select({
      id: temporalEvent.id,
      kind: temporalEvent.kind,
      semanticSummary: temporalEvent.semanticSummary,
      sourceTextSpan: temporalEvent.sourceTextSpan,
      timePrecision: temporalEvent.timePrecision,
      timezone: temporalEvent.timezone,
      isAllDay: temporalEvent.isAllDay,
      confidence: temporalEvent.confidence,
      startAt: temporalEvent.startAt,
      endAt: temporalEvent.endAt,
      activePeriod: temporalEvent.activePeriod,
      graphSyncStatus: temporalEvent.graphSyncStatus,
      graphSyncError: temporalEvent.graphSyncError,
      lifecycleStatus: temporalEvent.lifecycleStatus,
      lifecycleUpdatedAt: temporalEvent.lifecycleUpdatedAt,
      snoozedUntil: temporalEvent.snoozedUntil,
      recurrenceRule: temporalEvent.recurrenceRule,
      durationMinutes: temporalEvent.durationMinutes,
      energyLevel: temporalEvent.energyLevel,
      priorityQuadrant: temporalEvent.priorityQuadrant,
      contextTags: temporalEvent.contextTags,
      focusRank: temporalEvent.focusRank,
      parentEventId: temporalEvent.parentEventId,
      thoughtId: temporalEvent.thoughtId,
      thoughtText: thought.normalizedText,
      thoughtTextEncrypted: thought.normalizedTextEncrypted,
      thoughtCategory: thought.category,
      thoughtMetadata: thought.metadata,
      thoughtMetadataEncrypted: thought.metadataEncrypted,
      thoughtLifecycleStatus: thought.lifecycleStatus,
      thoughtLifecycleCompletedAt: thought.lifecycleCompletedAt,
      thoughtAuthor: thought.author,
      thoughtAuthorLabel: thought.authorLabel,
      createdAt: temporalEvent.createdAt,
    })
    .from(temporalEvent)
    .innerJoin(thought, eq(temporalEvent.thoughtId, thought.id))
    .where(and(...conditions))
    .orderBy(
      query.sortDirection === 'asc'
        ? query.orderBy === 'ingest'
          ? asc(thought.createdAt)
          : asc(temporalEvent.startAt)
        : query.orderBy === 'ingest'
          ? desc(thought.createdAt)
          : desc(temporalEvent.startAt),
      query.sortDirection === 'asc' ? asc(temporalEvent.id) : desc(temporalEvent.id),
    )
    .limit(limit + 1)

  const page = rows.slice(0, limit)
  const items: TemporalEventListItem[] = await Promise.all(
    page.map(async (r) => {
      const [thoughtText, metadataJson] = await Promise.all([
        r.thoughtTextEncrypted
          ? decryptTenantValue({
              userId: query.userId,
              table: 'thought',
              column: 'normalized_text',
              ciphertext: r.thoughtTextEncrypted,
            })
          : Promise.resolve(r.thoughtText),
        r.thoughtMetadataEncrypted
          ? decryptTenantValue({
              userId: query.userId,
              table: 'thought',
              column: 'metadata',
              ciphertext: r.thoughtMetadataEncrypted,
            })
          : Promise.resolve(JSON.stringify(r.thoughtMetadata ?? {})),
      ])
      const metadata = JSON.parse(metadataJson) as Record<string, unknown>
      return mapEventRow({
        ...r,
        thoughtText,
        thoughtStatus: thoughtLifecycleFromRow({
          lifecycleStatus: r.thoughtLifecycleStatus,
          metadata,
        }),
        completedAt: completedAtFromThought({
          lifecycleCompletedAt: r.thoughtLifecycleCompletedAt,
          metadata,
        }),
        lifecycleUpdatedAt: r.lifecycleUpdatedAt,
        author: r.thoughtAuthor,
        authorLabel: r.thoughtAuthorLabel,
      })
    }),
  )

  const hasMore = rows.length > limit
  const last = page[page.length - 1]
  const nextCursor =
    hasMore && last?.startAt ? { startAt: last.startAt.toISOString(), id: last.id } : null

  let merged = items
  if (query.includeTasks !== false && !query.cursorStartAt) {
    const includeUndated = query.includeUndated ?? true
    const tasks =
      hasAbsoluteBounds(query) && !includeUndated
        ? []
        : await listTaskThoughtsForUser(
            query.userId,
            query.status ?? 'open',
            query.orderBy,
            query.sortDirection,
            { author: query.author, authorLayerKey: query.authorLayerKey },
          )
    merged = [...items, ...tasks]

    /** Sort merged list by the same criteria */
    merged.sort((a, b) => {
      let cmp: number
      if (query.orderBy === 'ingest') {
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      } else {
        const aStart = a.startAt ? new Date(a.startAt).getTime() : 0
        const bStart = b.startAt ? new Date(b.startAt).getTime() : 0
        cmp = aStart - bStart
      }
      return query.sortDirection === 'asc' ? cmp : -cmp
    })
  }

  const thoughtIds = [...new Set(merged.map((i) => i.thoughtId))]
  const projectLinks = await loadProjectLinksByThoughtId(query.userId, thoughtIds)
  return { items: attachProjectLinks(merged, projectLinks), nextCursor }
}

export async function getTemporalEventListItemById(
  userId: string,
  eventId: string,
): Promise<TemporalEventListItem | null> {
  const thoughtId = thoughtIdFromTaskItemId(eventId)
  if (thoughtId) {
    const tasks = await listTaskThoughtsForUser(userId, 'all')
    return tasks.find((i) => i.thoughtId === thoughtId) ?? null
  }

  // Bare thought uuid (no `task:` prefix) — capture-page rows are plain thoughts
  // without a temporal_event row. Resolve directly so lifecycle quick actions
  // (mark done / reopen / archive) work on any surface.
  if (UUID_RE.test(eventId)) {
    return getThoughtListItemById(userId, eventId)
  }

  const rows = await getDb()
    .select({
      id: temporalEvent.id,
      kind: temporalEvent.kind,
      semanticSummary: temporalEvent.semanticSummary,
      sourceTextSpan: temporalEvent.sourceTextSpan,
      timePrecision: temporalEvent.timePrecision,
      timezone: temporalEvent.timezone,
      isAllDay: temporalEvent.isAllDay,
      confidence: temporalEvent.confidence,
      startAt: temporalEvent.startAt,
      endAt: temporalEvent.endAt,
      activePeriod: temporalEvent.activePeriod,
      graphSyncStatus: temporalEvent.graphSyncStatus,
      graphSyncError: temporalEvent.graphSyncError,
      lifecycleStatus: temporalEvent.lifecycleStatus,
      lifecycleUpdatedAt: temporalEvent.lifecycleUpdatedAt,
      snoozedUntil: temporalEvent.snoozedUntil,
      recurrenceRule: temporalEvent.recurrenceRule,
      durationMinutes: temporalEvent.durationMinutes,
      energyLevel: temporalEvent.energyLevel,
      priorityQuadrant: temporalEvent.priorityQuadrant,
      contextTags: temporalEvent.contextTags,
      focusRank: temporalEvent.focusRank,
      parentEventId: temporalEvent.parentEventId,
      thoughtId: temporalEvent.thoughtId,
      thoughtText: thought.normalizedText,
      thoughtTextEncrypted: thought.normalizedTextEncrypted,
      thoughtCategory: thought.category,
      thoughtMetadata: thought.metadata,
      thoughtMetadataEncrypted: thought.metadataEncrypted,
      thoughtLifecycleStatus: thought.lifecycleStatus,
      thoughtLifecycleCompletedAt: thought.lifecycleCompletedAt,
      thoughtAuthor: thought.author,
      thoughtAuthorLabel: thought.authorLabel,
      createdAt: temporalEvent.createdAt,
    })
    .from(temporalEvent)
    .innerJoin(thought, eq(temporalEvent.thoughtId, thought.id))
    .where(and(eq(temporalEvent.userId, userId), eq(temporalEvent.id, eventId)))
    .limit(1)

  const r = rows[0]
  if (!r) return null

  const [thoughtText, metadataJson] = await Promise.all([
    r.thoughtTextEncrypted
      ? decryptTenantValue({
          userId,
          table: 'thought',
          column: 'normalized_text',
          ciphertext: r.thoughtTextEncrypted,
        })
      : Promise.resolve(r.thoughtText),
    r.thoughtMetadataEncrypted
      ? decryptTenantValue({
          userId,
          table: 'thought',
          column: 'metadata',
          ciphertext: r.thoughtMetadataEncrypted,
        })
      : Promise.resolve(JSON.stringify(r.thoughtMetadata ?? {})),
  ])
  const metadata = JSON.parse(metadataJson) as Record<string, unknown>
  return mapEventRow({
    ...r,
    thoughtText,
    thoughtStatus: thoughtLifecycleFromRow({
      lifecycleStatus: r.thoughtLifecycleStatus,
      metadata,
    }),
    completedAt: completedAtFromThought({
      lifecycleCompletedAt: r.thoughtLifecycleCompletedAt,
      metadata,
    }),
    lifecycleUpdatedAt: r.lifecycleUpdatedAt,
    author: r.thoughtAuthor,
    authorLabel: r.thoughtAuthorLabel,
  })
}

/** Recompute and persist focus_rank for open events (called after enrich). */
export async function refreshFocusRanksForUser(
  userId: string,
  timeZone: string,
  now = new Date(),
): Promise<void> {
  const { items } = await listTemporalEventsForUser({
    userId,
    status: 'open',
    range: 'all',
    includeTasks: false,
  })

  const db = getDb()
  for (const item of items) {
    if (item.itemType !== 'event') continue
    const rank = computeFocusRank(item, now, timeZone)
    await db
      .update(temporalEvent)
      .set({ focusRank: rank, updatedAt: now })
      .where(and(eq(temporalEvent.id, item.id), eq(temporalEvent.userId, userId)))
  }
}
