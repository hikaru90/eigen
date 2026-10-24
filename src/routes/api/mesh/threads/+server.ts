import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import type { MemoryAuthor } from '$lib/server/db/schema'
import { loadThreadList } from '$lib/server/mesh/thread-list'

function parseAuthor(raw: string | null): MemoryAuthor | 'all' | null {
  if (raw === 'all' || raw === 'agent' || raw === 'user') return raw
  return null
}

/**
 * The Threads list API — the same loadThreadList the page server seeds with,
 * scoped to the global data view. A specific agent layer comes in as
 * authorLayerKey (same key format as /api/timeline); otherwise author is
 * required — no implicit scope.
 */
export const GET: RequestHandler = async (event) => {
  if (!event.locals.user) error(401, 'Unauthorized')

  const authorLayerKey = event.url.searchParams.get('authorLayerKey')
  if (authorLayerKey) {
    return json(await loadThreadList(event.locals.user.id, { author: undefined, authorLayerKey }))
  }

  const author = parseAuthor(event.url.searchParams.get('author'))
  if (!author) error(400, 'author must be user, agent or all (or pass authorLayerKey)')

  return json(await loadThreadList(event.locals.user.id, { author, authorLayerKey: null }))
}
