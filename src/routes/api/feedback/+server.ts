import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getDb } from '$lib/server/db'
import { feedback } from '$lib/server/db/schema'
import { jsonError } from '$lib/server/http/api-error'
import { feedbackPostBodySchema } from '$lib/validation/api-bodies'

export const POST: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) {
    return jsonError('Unauthorized', 401)
  }

  let body: unknown
  try {
    body = await event.request.json()
  } catch {
    return jsonError('Invalid JSON', 400)
  }

  const parsed = feedbackPostBodySchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Invalid body'
    return jsonError(message, 400)
  }

  const db = getDb()
  const [inserted] = await db
    .insert(feedback)
    .values({ userId: user.id, message: parsed.data.message })
    .returning({ id: feedback.id })

  return json({ ok: true, id: inserted.id }, { status: 201 })
}
