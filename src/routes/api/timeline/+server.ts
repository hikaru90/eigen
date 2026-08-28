import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import type { MemoryAuthor } from '$lib/server/db/brain.schema'
import {
  loadUnifiedTimeline,
  type TimelineUnifiedResponse,
} from '$lib/server/memory/timeline-unified'

export type { TimelineUnifiedResponse }

function parseAuthor(raw: string | null): MemoryAuthor | 'all' | undefined {
  if (raw === null) return undefined
  if (raw === 'all') return 'all'
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
  const from = parseOptionalIso(url.searchParams.get('from'))
  const to = parseOptionalIso(url.searchParams.get('to'))
  const includeUndatedParam = url.searchParams.get('includeUndated')
  const includeUndated = includeUndatedParam === null ? undefined : includeUndatedParam !== 'false'
  const authorLayerKey = url.searchParams.get('authorLayerKey')
  const authorParam = parseAuthor(url.searchParams.get('author'))
  const author = authorLayerKey ? undefined : authorParam
  const orderBy = url.searchParams.get('orderBy') as 'ingest' | 'todo' | null
  const sortDirection = url.searchParams.get('sortDirection') as 'asc' | 'desc' | null

  const body = await loadUnifiedTimeline({
    userId: user.id,
    from: from === undefined ? null : from,
    to: to === undefined ? null : to,
    includeUndated,
    author,
    authorLayerKey,
    orderBy: orderBy ?? 'ingest',
    sortDirection: sortDirection ?? 'desc',
  })

  return json(body satisfies TimelineUnifiedResponse)
}
