import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import {
  listTemporalEventsForUser,
  type TemporalEventListItem,
} from '$lib/server/memory/temporal-event-list'

import type { MemoryAuthor } from '$lib/server/db/brain.schema'

export type { TemporalEventListItem }

export type TemporalEventsResponse = {
  items: TemporalEventListItem[]
  nextCursor: { startAt: string; id: string } | null
}

function parseKinds(raw: string | null): string[] | undefined {
  if (!raw?.trim()) return undefined
  return raw
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
}

function parseAuthor(raw: string | null): MemoryAuthor | undefined {
  if (raw === null || raw === 'all') return undefined
  if (raw === 'agent') return 'agent'
  if (raw === 'user') return 'user'
  return undefined
}

function parseOptionalIso(raw: string | null): string | null | undefined {
  if (raw === null) return undefined
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (!Number.isFinite(Date.parse(trimmed))) return undefined
  return trimmed
}

export const GET: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const url = event.url
  const range = url.searchParams.get('range') as 'relevant' | 'upcoming' | 'past' | 'all' | null
  const status = url.searchParams.get('status') as 'open' | 'all' | null
  const kinds = parseKinds(url.searchParams.get('kinds'))
  const limitRaw = url.searchParams.get('limit')
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined
  const cursorStartAt = url.searchParams.get('cursorStartAt')
  const cursorId = url.searchParams.get('cursorId')
  const includeTasks =
    url.searchParams.get('includeTasks') !== 'false' &&
    url.searchParams.get('includeOpenLoops') !== 'false'
  const orderBy = url.searchParams.get('orderBy') as 'ingest' | 'todo' | null
  const sortDirection = url.searchParams.get('sortDirection') as 'asc' | 'desc' | null
  const authorLayerKey = url.searchParams.get('authorLayerKey')
  const author = authorLayerKey ? undefined : parseAuthor(url.searchParams.get('author'))
  const from = parseOptionalIso(url.searchParams.get('from'))
  const to = parseOptionalIso(url.searchParams.get('to'))
  const includeUndatedParam = url.searchParams.get('includeUndated')
  const includeUndated = includeUndatedParam === null ? undefined : includeUndatedParam !== 'false'

  const hasAbsolute = from !== undefined || to !== undefined

  const { items, nextCursor } = await listTemporalEventsForUser({
    userId: user.id,
    range: hasAbsolute ? undefined : (range ?? 'relevant'),
    status: status ?? 'open',
    kinds,
    includeTasks,
    limit: Number.isFinite(limit) ? limit : undefined,
    cursorStartAt,
    cursorId,
    orderBy: orderBy ?? 'todo',
    sortDirection: sortDirection ?? 'desc',
    author,
    authorLayerKey,
    from: from === undefined ? undefined : from,
    to: to === undefined ? undefined : to,
    includeUndated,
  })

  return json({ items, nextCursor } satisfies TemporalEventsResponse)
}
