import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import {
  insufficientCreditsPayload,
  isInsufficientCreditsError,
} from '$lib/server/billing/insufficient-credits'
import {
  dismissTodaysReflectionPrompts,
  loadTodaysReflectionPrompts,
} from '$lib/server/capture/reflection-prompt-store'

/** Capture's reflection prompts for today (docs/planning/feature-capture-reflection-prompts.md). */
export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return json(await loadTodaysReflectionPrompts(locals.user.id))
  } catch (err) {
    if (isInsufficientCreditsError(err)) {
      return json(insufficientCreditsPayload(err), { status: 402 })
    }
    const message = err instanceof Error ? err.message : String(err)
    return json({ error: message }, { status: 502 })
  }
}

/** "Not today". */
export const POST: RequestHandler = async ({ locals }) => {
  if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 })
  await dismissTodaysReflectionPrompts(locals.user.id)
  return json({ ok: true as const })
}
