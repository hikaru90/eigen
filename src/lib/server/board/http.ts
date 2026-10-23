import { json } from '@sveltejs/kit'
import {
  insufficientCreditsPayload,
  isInsufficientCreditsError,
} from '$lib/server/billing/insufficient-credits'
import { jsonError } from '$lib/server/http/api-error'
import { BoardError, isBoardError } from './errors'

/** Read a JSON body or fail with 400. */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new BoardError('Invalid JSON', 400)
  }
}

/**
 * Shared error mapping for `/api/board/*`: board refusals keep their status,
 * an empty wallet is 402 with the credits payload, anything else is a 500 with
 * the message (explicit, never swallowed).
 */
export async function boardHandler(
  user: App.Locals['user'],
  run: (userId: string) => Promise<Response>,
): Promise<Response> {
  if (!user) return jsonError('Unauthorized', 401)
  try {
    return await run(user.id)
  } catch (err) {
    if (isBoardError(err)) return jsonError(err.message, err.status)
    if (isInsufficientCreditsError(err))
      return json(insufficientCreditsPayload(err), { status: 402 })
    const message = err instanceof Error ? err.message : String(err)
    console.error('[board] request failed', { userId: user.id, message })
    return jsonError(message || 'Board request failed', 500)
  }
}
