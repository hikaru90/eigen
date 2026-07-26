import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getDb } from '$lib/server/db'
import { feedback } from '$lib/server/db/schema'
import {
  assertFeedbackMailConfigured,
  sendFeedbackInboxEmail,
} from '$lib/server/feedback/send-feedback-email'
import { jsonError } from '$lib/server/http/api-error'
import { feedbackPostBodySchema } from '$lib/validation/api-bodies'

export const POST: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) {
    return jsonError('Unauthorized', 401)
  }

  const userEmail = typeof user.email === 'string' ? user.email.trim() : ''
  if (!userEmail) {
    return jsonError('Authenticated user has no email address', 400)
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

  try {
    assertFeedbackMailConfigured()
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : 'Feedback email is not configured', 503)
  }

  const db = getDb()
  const [inserted] = await db
    .insert(feedback)
    .values({ userId: user.id, message: parsed.data.message })
    .returning({ id: feedback.id })

  try {
    await sendFeedbackInboxEmail({
      feedbackId: inserted.id,
      userId: user.id,
      userEmail,
      message: parsed.data.message,
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return jsonError(`Failed to deliver feedback email: ${detail}`, 502)
  }

  return json({ ok: true, id: inserted.id }, { status: 201 })
}
