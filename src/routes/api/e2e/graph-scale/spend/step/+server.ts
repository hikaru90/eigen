import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import { dev } from '$app/environment'
import { ingestSpendProbeThought } from '$lib/server/e2e/graph-scale-spend'

export const POST: RequestHandler = async ({ request }) => {
  if (!dev) {
    return json({ error: 'Graph-scale spend API only available in dev mode' }, { status: 403 })
  }

  let body: { userId?: string; index?: number; rawText?: string }
  try {
    body = (await request.json()) as { userId?: string; index?: number; rawText?: string }
  } catch {
    error(400, 'Invalid JSON body')
  }

  const userId = body.userId?.trim()
  if (!userId) {
    error(400, 'userId is required')
  }
  if (!userId.startsWith('graph-scale-spend-')) {
    error(400, 'userId must be a graph-scale spend probe user')
  }

  const index = body.index
  if (!Number.isInteger(index) || index < 0) {
    error(400, 'index must be a non-negative integer')
  }

  const rawText = body.rawText?.trim()
  if (!rawText) {
    error(400, 'rawText is required')
  }

  const row = await ingestSpendProbeThought({ userId, index, rawText })
  return json(row)
}
