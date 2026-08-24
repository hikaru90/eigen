import type { RequestHandler } from './$types'
import { json, error } from '@sveltejs/kit'
import { eq, and } from 'drizzle-orm'
import type { SignatureMode } from '$lib/server/agents/sign'
import { getDb } from '$lib/server/db'
import { inboundWebhookSubscription } from '$lib/server/db/schema'

/**
 * PATCH /api/webhooks/inbound/manage/[id]
 * Update an inbound webhook subscription.
 */
export const PATCH: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const id = event.params.id?.trim()
  if (!id) error(400, 'Missing webhook ID')

  let body: {
    name?: string
    signatureMode?: SignatureMode
    subscribedEvents?: string[]
    enabled?: boolean
    agentId?: string | null
  }
  try {
    body = await event.request.json()
  } catch {
    error(400, 'Invalid JSON body')
  }

  const db = getDb()
  const patch: Partial<typeof inboundWebhookSubscription.$inferInsert> = {}

  if (body.name !== undefined) {
    const trimmed = body.name.trim()
    if (!trimmed) error(400, 'name cannot be empty')
    patch.name = trimmed
  }

  if (body.signatureMode !== undefined) {
    if (!['github', 'gitlab', 'generic'].includes(body.signatureMode)) {
      error(400, 'signatureMode must be "github", "gitlab", or "generic"')
    }
    patch.signatureMode = body.signatureMode
  }

  if (body.subscribedEvents !== undefined) {
    patch.subscribedEvents = body.subscribedEvents
  }

  if (body.enabled !== undefined) {
    patch.enabled = body.enabled
  }

  if (body.agentId !== undefined) {
    patch.agentId = body.agentId
  }

  if (Object.keys(patch).length === 0) {
    error(400, 'No fields to update')
  }

  const [row] = await db
    .update(inboundWebhookSubscription)
    .set(patch)
    .where(
      and(eq(inboundWebhookSubscription.userId, user.id), eq(inboundWebhookSubscription.id, id)),
    )
    .returning({ id: inboundWebhookSubscription.id })

  if (!row) {
    error(404, 'Webhook subscription not found')
  }

  return json({ ok: true })
}

/**
 * DELETE /api/webhooks/inbound/manage/[id]
 * Delete an inbound webhook subscription.
 */
export const DELETE: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const id = event.params.id?.trim()
  if (!id) error(400, 'Missing webhook ID')

  const db = getDb()
  const result = await db
    .delete(inboundWebhookSubscription)
    .where(
      and(eq(inboundWebhookSubscription.userId, user.id), eq(inboundWebhookSubscription.id, id)),
    )
    .returning({ id: inboundWebhookSubscription.id })

  if (result.length === 0) {
    error(404, 'Webhook subscription not found')
  }

  return json({ ok: true })
}
