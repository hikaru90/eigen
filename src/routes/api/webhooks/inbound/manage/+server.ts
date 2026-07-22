import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getDb } from '$lib/server/db'
import { inboundWebhookSubscription } from '$lib/server/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { encryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { createHmac, randomBytes } from 'node:crypto'
import type { SignatureMode } from '$lib/server/agents/sign'

export type InboundWebhookSubscriptionResponse = {
  id: string
  name: string
  slug: string
  signatureMode: SignatureMode
  subscribedEvents: string[]
  enabled: boolean
  agentId: string | null
  createdAt: string
}

/**
 * GET /api/webhooks/inbound/manage
 * List all inbound webhook subscriptions for the current user.
 */
export const GET: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const db = getDb()
  const rows = await db
    .select()
    .from(inboundWebhookSubscription)
    .where(eq(inboundWebhookSubscription.userId, user.id))
    .orderBy(desc(inboundWebhookSubscription.createdAt))

  return json({
    subscriptions: rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      signatureMode: row.signatureMode as SignatureMode,
      subscribedEvents: row.subscribedEvents,
      enabled: row.enabled,
      agentId: row.agentId,
      createdAt: row.createdAt.toISOString(),
    })),
  })
}

export type CreateInboundWebhookRequest = {
  name: string
  slug?: string
  signatureMode?: SignatureMode
  subscribedEvents?: string[]
  agentId?: string
}

/**
 * POST /api/webhooks/inbound/manage
 * Create a new inbound webhook subscription.
 */
export const POST: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  let body: CreateInboundWebhookRequest
  try {
    body = await event.request.json()
  } catch {
    error(400, 'Invalid JSON body')
  }

  const name = body.name?.trim()
  if (!name) error(400, 'name is required')

  // Validate signature mode
  const signatureMode: SignatureMode = body.signatureMode ?? 'generic'
  if (!['github', 'gitlab', 'generic'].includes(signatureMode)) {
    error(400, 'signatureMode must be "github", "gitlab", or "generic"')
  }

  // Generate slug if not provided
  const slug = body.slug?.trim() || generateSlug(name)

  // Validate slug format
  if (!/^[a-z0-9-]+$/.test(slug)) {
    error(400, 'slug must contain only lowercase letters, numbers, and hyphens')
  }

  // Generate signing secret
  const signingSecret = randomBytes(32).toString('hex')

  const signingSecretEncrypted = await encryptTenantValue({
    userId: user.id,
    table: 'inbound_webhook_subscription',
    column: 'signing_secret',
    plaintext: signingSecret,
  })

  const db = getDb()

  // Check for duplicate slug
  const [existing] = await db
    .select({ id: inboundWebhookSubscription.id })
    .from(inboundWebhookSubscription)
    .where(
      and(
        eq(inboundWebhookSubscription.userId, user.id),
        eq(inboundWebhookSubscription.slug, slug),
      ),
    )
    .limit(1)

  if (existing) {
    error(409, 'A webhook with this slug already exists')
  }

  const [row] = await db
    .insert(inboundWebhookSubscription)
    .values({
      userId: user.id,
      name,
      slug,
      signatureMode,
      signingSecretEncrypted,
      subscribedEvents: body.subscribedEvents ?? [],
      agentId: body.agentId ?? null,
    })
    .returning({ id: inboundWebhookSubscription.id })

  if (!row) {
    error(500, 'Failed to create webhook subscription')
  }

  return json({
    id: row.id,
    slug,
    signatureMode,
    signingSecret,
    webhookUrl: `/api/webhooks/inbound/${slug}`,
  })
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
}
