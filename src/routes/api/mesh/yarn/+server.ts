import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import type { MemoryAuthor } from '$lib/server/db/schema'
import { loadYarnThoughts } from '$lib/server/mesh/yarn-list'

function parseAuthor(raw: string | null): MemoryAuthor | 'all' | undefined {
  if (raw === null) return undefined
  if (raw === 'all') return 'all'
  if (raw === 'agent') return 'agent'
  if (raw === 'user') return 'user'
  return undefined
}

/**
 * The Yarn journal's list API — the same loadYarnThoughts the page server
 * seeds with, parameterized by the global data view's author scope. `all`
 * spans the whole tenant (you + your agents); a specific agent layer comes
 * in as authorLayerKey (same key format as /api/timeline).
 */
export const GET: RequestHandler = async (event) => {
  if (!event.locals.user) error(401, 'Unauthorized')

  const url = event.url
  const authorLayerKey = url.searchParams.get('authorLayerKey')
  const authorParam = parseAuthor(url.searchParams.get('author'))
  const author = authorLayerKey ? undefined : authorParam

  const thoughts = await loadYarnThoughts(event.locals.user.id, { author, authorLayerKey })

  return json({ thoughts })
}
