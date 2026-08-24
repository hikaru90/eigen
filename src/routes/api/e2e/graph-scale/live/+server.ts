import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { dev } from '$app/environment'
import { readGraphScaleLiveState } from '$lib/server/e2e/graph-scale-live-state'

export const GET: RequestHandler = async () => {
  if (!dev) {
    return json({ error: 'Graph-scale live API only available in dev mode' }, { status: 403 })
  }

  const state = readGraphScaleLiveState()
  if (!state) {
    return json({ active: false, state: null })
  }

  return json({ active: state.status !== 'finished' && state.status !== 'failed', state })
}
