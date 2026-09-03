import type { RequestHandler } from './$types'
import { json, error } from '@sveltejs/kit'
import { eq, and } from 'drizzle-orm'
import { runAgentWithEvent } from '$lib/server/agents/run-agent'
import { validateWebhookSignature, type SignatureMode } from '$lib/server/agents/sign'
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import { inboundWebhookSubscription, connectedAgent } from '$lib/server/db/schema'

export type InboundWebhookResponse = {
  received: true
  eventType: string
  deliveryId?: string
  agentRunId?: string
}

/**
 * POST /api/webhooks/inbound/[slug]
 *
 * Receive inbound webhooks from external services (GitHub, GitLab, Hermes, etc.).
 * The slug identifies which subscription to use.
 *
 * Supports Hermes webhook format:
 * - GitHub: X-Hub-Signature-256, X-GitHub-Event, X-GitHub-Delivery
 * - GitLab: X-Gitlab-Token, X-Gitlab-Event
 * - Generic: X-Webhook-Signature, X-Event-Type, X-Request-ID
 */
export const POST: RequestHandler = async (event) => {
  const slug = event.url.pathname
    .replace(/^\/api\/webhooks\/inbound\/?/, '')
    .split('/')[0]
    ?.trim()
  if (!slug) error(400, 'Missing webhook slug')

  // Find subscription by slug
  const db = getDb()
  const [subscription] = await db
    .select()
    .from(inboundWebhookSubscription)
    .where(
      and(eq(inboundWebhookSubscription.slug, slug), eq(inboundWebhookSubscription.enabled, true)),
    )
    .limit(1)

  if (!subscription) {
    error(404, `Webhook subscription not found: ${slug}`)
  }

  // IMPORTANT: Read the raw body FIRST before parsing JSON.
  // The body stream can only be consumed once.
  const rawBody = await event.request.text()

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody)
  } catch {
    error(400, 'Invalid JSON body')
  }

  // Extract event type and delivery ID based on signature mode
  const signatureMode: SignatureMode = subscription.signatureMode as SignatureMode
  let eventType: string
  let deliveryId: string | undefined

  if (signatureMode === 'github') {
    // GitHub: event type from X-GitHub-Event, delivery ID from X-GitHub-Delivery
    eventType =
      event.request.headers.get('x-github-event') ??
      (typeof payload.event === 'string' ? payload.event : 'webhook.received')
    deliveryId = event.request.headers.get('x-github-delivery') ?? undefined
  } else if (signatureMode === 'gitlab') {
    // GitLab: event type from X-Gitlab-Event, no standard delivery ID header
    eventType =
      event.request.headers.get('x-gitlab-event') ??
      (typeof payload.event === 'string' ? payload.event : 'webhook.received')
    deliveryId = undefined
  } else {
    // Generic: event type from X-Event-Type, delivery ID from X-Request-ID
    eventType =
      event.request.headers.get('x-event-type') ??
      (typeof payload.event === 'string' ? payload.event : 'webhook.received')
    deliveryId = event.request.headers.get('x-request-id') ?? undefined
  }

  // Check if this event type is subscribed
  if (
    subscription.subscribedEvents.length > 0 &&
    !subscription.subscribedEvents.includes(eventType)
  ) {
    return json({ received: true, ignored: true, reason: 'Event type not subscribed' })
  }

  // Verify signature if signing secret is configured
  if (subscription.signingSecretEncrypted) {
    const signingSecret = await decryptTenantValue({
      userId: subscription.userId,
      table: 'inbound_webhook_subscription',
      column: 'signing_secret_encrypted',
      ciphertext: subscription.signingSecretEncrypted,
    })

    // Get signature header based on mode
    let receivedSignature: string | null

    if (signatureMode === 'github') {
      receivedSignature = event.request.headers.get('x-hub-signature-256')
    } else if (signatureMode === 'gitlab') {
      receivedSignature = event.request.headers.get('x-gitlab-token')
    } else {
      receivedSignature = event.request.headers.get('x-webhook-signature')
    }

    if (!receivedSignature) {
      error(401, 'Missing webhook signature')
    }

    // For GitHub and Generic modes, extract the timestamp used for signing.
    // GitHub does NOT include a timestamp — it signs just the body.
    // Generic mode uses an optional X-Timestamp header.
    let timestamp: number | undefined
    if (signatureMode === 'generic') {
      const tsHeader = event.request.headers.get('x-timestamp')
      timestamp = tsHeader ? parseInt(tsHeader, 10) : undefined
    }

    const isValid = validateWebhookSignature({
      mode: signatureMode,
      secret: signingSecret,
      rawBody,
      receivedSignature,
      timestamp,
    })

    if (!isValid) {
      error(401, 'Invalid webhook signature')
    }
  }

  // Log the inbound webhook
  console.log(`[webhook-inbound] Received ${eventType} on ${slug}`, {
    userId: subscription.userId,
    subscriptionId: subscription.id,
    deliveryId,
  })

  // If an agent is configured, run it with the event payload
  let agentRunId: string | undefined
  if (subscription.agentId) {
    try {
      const [agent] = await db
        .select()
        .from(connectedAgent)
        .where(eq(connectedAgent.id, subscription.agentId))
        .limit(1)

      if (agent && agent.enabled) {
        const result = await runAgentWithEvent({
          userId: subscription.userId,
          agentId: agent.id,
          eventType,
          payload,
        })
        agentRunId = result.runId
      }
    } catch (err) {
      console.error('[webhook-inbound] Agent run failed:', err)
      // Don't fail the webhook delivery — agent failure is non-fatal
    }
  }

  return json({
    received: true,
    eventType,
    deliveryId,
    agentRunId,
  } satisfies InboundWebhookResponse)
}
