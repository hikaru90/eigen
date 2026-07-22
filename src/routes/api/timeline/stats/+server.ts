import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { computeTimelineStatsForUser } from '$lib/server/memory/timeline-stats'
import type { MemoryAuthor } from '$lib/server/db/brain.schema'

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
  const from = parseOptionalIso(url.searchParams.get('from'))
  const to = parseOptionalIso(url.searchParams.get('to'))
  const includeUndatedParam = url.searchParams.get('includeUndated')
  const includeUndated = includeUndatedParam === null ? undefined : includeUndatedParam !== 'false'
  const authorLayerKey = url.searchParams.get('authorLayerKey')
  const author = authorLayerKey ? undefined : parseAuthor(url.searchParams.get('author'))

  const started = Date.now()
  const stats = await computeTimelineStatsForUser({
    userId: user.id,
    from: from === undefined ? undefined : from,
    to: to === undefined ? undefined : to,
    includeUndated,
    author,
    authorLayerKey,
  })
  console.info(
    `[timeline/stats] userId=${user.id} durationMs=${Date.now() - started} from=${from ?? ''} to=${to ?? ''}`,
  )
  return json(stats)
}
