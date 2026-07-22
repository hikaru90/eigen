import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import {
  loadRecentCaptureThoughts,
  type RecentCaptureFilter,
} from '$lib/server/capture/load-recent-capture-thoughts'
import { syncAndScheduleCaptureEnrichQueue } from '$lib/server/capture/sync-capture-enrich-queue'
import type { MemoryAuthor } from '$lib/server/db/schema'

export const GET: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const url = new URL(event.request.url)
  const limitParam = url.searchParams.get('limit')
  const limit = limitParam ? Math.max(1, Math.min(parseInt(limitParam, 10) || 8, 50)) : 8

  const filter: RecentCaptureFilter = {}

  const authorParam = url.searchParams.get('author')
  if (authorParam === 'user' || authorParam === 'agent') {
    filter.author = authorParam as MemoryAuthor
  }

  const authorLayerKey = url.searchParams.get('authorLayerKey')
  if (authorLayerKey) {
    filter.authorLayerKey = authorLayerKey
    filter.author = undefined
  }

  const categoryParam = url.searchParams.get('category')
  if (categoryParam) {
    filter.category = categoryParam
  }

  const memoryTypeParam = url.searchParams.get('memoryType')
  if (memoryTypeParam) {
    filter.memoryType = memoryTypeParam
  }

  const dateFromParam = url.searchParams.get('dateFrom')
  if (dateFromParam) {
    const d = new Date(dateFromParam)
    if (!Number.isNaN(d.getTime())) {
      filter.dateFrom = d
    }
  }

  const dateToParam = url.searchParams.get('dateTo')
  if (dateToParam) {
    const d = new Date(dateToParam)
    if (!Number.isNaN(d.getTime())) {
      filter.dateTo = d
    }
  }

  await syncAndScheduleCaptureEnrichQueue(user.id)
  const payload = await loadRecentCaptureThoughts(user.id, limit, filter)
  return json(payload)
}
