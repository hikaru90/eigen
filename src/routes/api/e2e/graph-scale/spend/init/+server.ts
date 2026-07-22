import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { dev } from '$app/environment'
import { createSpendProbeUser } from '$lib/server/e2e/graph-scale-spend'

export const POST: RequestHandler = async () => {
  if (!dev) {
    return json({ error: 'Graph-scale spend API only available in dev mode' }, { status: 403 })
  }

  const user = await createSpendProbeUser()
  return json(user)
}
