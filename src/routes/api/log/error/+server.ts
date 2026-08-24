import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'

/**
 * Client-side error logging endpoint.
 * The client POSTs errors here so they appear in server logs.
 */
export const POST: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) return json({ ok: true })

  let body: unknown
  try {
    body = await event.request.json()
  } catch {
    return json({ ok: true })
  }

  const message =
    typeof body === 'object' && body && 'message' in body
      ? String((body as { message?: unknown }).message)
      : 'unknown error'
  const context =
    typeof body === 'object' && body && 'context' in body
      ? String((body as { context?: unknown }).context)
      : 'client'
  const stack =
    typeof body === 'object' && body && 'stack' in body
      ? String((body as { stack?: unknown }).stack)
      : undefined

  console.error(`[client.${context}] ${message}`, {
    userId: user.id,
    stack: stack?.slice(0, 500),
  })

  return json({ ok: true })
}
