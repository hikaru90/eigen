import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { encryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import {
  connectedAgent,
  webhookDelivery,
  agentTaskAssignment,
  agentProjectBinding,
  canonicalEntity,
  type AgentSubscribableEventType,
} from '$lib/server/db/schema'
import { AGENT_SUBSCRIBABLE_EVENTS } from './constants'
import { generateSigningSecret, generateCallbackToken } from './secret-utils'
import { validateAgentWebhookUrl } from './validate-url'

function parseSubscribedEvents(value: unknown): AgentSubscribableEventType[] {
  if (!Array.isArray(value)) return []
  const allowed = new Set<string>(AGENT_SUBSCRIBABLE_EVENTS)
  return value
    .filter((v): v is string => typeof v === 'string')
    .filter((v): v is AgentSubscribableEventType => allowed.has(v))
}

export async function listConnectedAgents(userId: string) {
  const db = getDb()
  return db
    .select({
      id: connectedAgent.id,
      name: connectedAgent.name,
      webhookUrl: connectedAgent.webhookUrl,
      subscribedEvents: connectedAgent.subscribedEvents,
      signingSecretPrefix: connectedAgent.signingSecretPrefix,
      callbackTokenPrefix: connectedAgent.callbackTokenPrefix,
      enabled: connectedAgent.enabled,
      lastDeliveryAt: connectedAgent.lastDeliveryAt,
      createdAt: connectedAgent.createdAt,
      updatedAt: connectedAgent.updatedAt,
    })
    .from(connectedAgent)
    .where(eq(connectedAgent.userId, userId))
    .orderBy(desc(connectedAgent.createdAt))
}

export async function createConnectedAgent(input: {
  userId: string
  name: string
  webhookUrl: string
  subscribedEvents: AgentSubscribableEventType[]
}) {
  const urlCheck = validateAgentWebhookUrl(input.webhookUrl)
  if (!urlCheck.ok) {
    throw new Error(urlCheck.error)
  }

  const signing = generateSigningSecret()
  const callback = generateCallbackToken()

  const signingSecretEncrypted = await encryptTenantValue({
    userId: input.userId,
    table: 'connected_agent',
    column: 'signing_secret',
    plaintext: signing.raw,
  })

  const db = getDb()
  const [row] = await db
    .insert(connectedAgent)
    .values({
      userId: input.userId,
      name: input.name,
      webhookUrl: urlCheck.url.toString(),
      subscribedEvents: input.subscribedEvents,
      signingSecretEncrypted,
      signingSecretPrefix: signing.prefix,
      callbackTokenHash: callback.hash,
      callbackTokenPrefix: callback.prefix,
      enabled: true,
    })
    .returning({ id: connectedAgent.id })

  if (!row) {
    throw new Error('Failed to create connected agent')
  }

  return {
    id: row.id,
    signingSecret: signing.raw,
    callbackToken: callback.raw,
  }
}

export async function updateConnectedAgent(input: {
  userId: string
  agentId: string
  name?: string
  webhookUrl?: string
  subscribedEvents?: AgentSubscribableEventType[]
  enabled?: boolean
}) {
  const db = getDb()
  const patch: Partial<typeof connectedAgent.$inferInsert> = {}

  if (input.name !== undefined) {
    const trimmed = input.name.trim()
    if (!trimmed) throw new Error('Agent name is required')
    patch.name = trimmed
  }

  if (input.webhookUrl !== undefined) {
    const urlCheck = validateAgentWebhookUrl(input.webhookUrl)
    if (!urlCheck.ok) throw new Error(urlCheck.error)
    patch.webhookUrl = urlCheck.url.toString()
  }

  if (input.subscribedEvents !== undefined) {
    patch.subscribedEvents = input.subscribedEvents
  }

  if (input.enabled !== undefined) {
    patch.enabled = input.enabled
  }

  if (Object.keys(patch).length === 0) {
    throw new Error('No fields to update')
  }

  const [row] = await db
    .update(connectedAgent)
    .set(patch)
    .where(and(eq(connectedAgent.userId, input.userId), eq(connectedAgent.id, input.agentId)))
    .returning({ id: connectedAgent.id })

  if (!row) {
    throw new Error('Connected agent not found')
  }

  return row
}

export async function deleteConnectedAgent(userId: string, agentId: string): Promise<void> {
  const db = getDb()
  const result = await db
    .delete(connectedAgent)
    .where(and(eq(connectedAgent.userId, userId), eq(connectedAgent.id, agentId)))
    .returning({ id: connectedAgent.id })
  if (result.length === 0) {
    throw new Error('Connected agent not found')
  }
}

export async function listWebhookDeliveries(userId: string, limit = 50) {
  const db = getDb()
  return db
    .select({
      id: webhookDelivery.id,
      agentId: webhookDelivery.agentId,
      eventType: webhookDelivery.eventType,
      eventId: webhookDelivery.eventId,
      status: webhookDelivery.status,
      attemptCount: webhookDelivery.attemptCount,
      httpStatus: webhookDelivery.httpStatus,
      lastError: webhookDelivery.lastError,
      deliveredAt: webhookDelivery.deliveredAt,
      createdAt: webhookDelivery.createdAt,
    })
    .from(webhookDelivery)
    .where(eq(webhookDelivery.userId, userId))
    .orderBy(desc(webhookDelivery.createdAt))
    .limit(limit)
}

export async function listAgentTaskAssignments(userId: string, limit = 50) {
  const db = getDb()
  return db
    .select({
      id: agentTaskAssignment.id,
      agentId: agentTaskAssignment.agentId,
      thoughtId: agentTaskAssignment.thoughtId,
      status: agentTaskAssignment.status,
      assignedAt: agentTaskAssignment.assignedAt,
      completedAt: agentTaskAssignment.completedAt,
      resultSummary: agentTaskAssignment.resultSummary,
      resultThoughtId: agentTaskAssignment.resultThoughtId,
      lastError: agentTaskAssignment.lastError,
    })
    .from(agentTaskAssignment)
    .where(eq(agentTaskAssignment.userId, userId))
    .orderBy(desc(agentTaskAssignment.assignedAt))
    .limit(limit)
}

export async function bindAgentToProject(input: {
  userId: string
  agentId: string
  projectEntityId: string
}): Promise<{ id: string }> {
  const db = getDb()

  const [agent] = await db
    .select({ id: connectedAgent.id })
    .from(connectedAgent)
    .where(and(eq(connectedAgent.userId, input.userId), eq(connectedAgent.id, input.agentId)))
    .limit(1)
  if (!agent) throw new Error('Connected agent not found')

  const [entity] = await db
    .select({ id: canonicalEntity.id })
    .from(canonicalEntity)
    .where(
      and(
        eq(canonicalEntity.userId, input.userId),
        eq(canonicalEntity.id, input.projectEntityId),
        isNotNull(canonicalEntity.projectStatus),
      ),
    )
    .limit(1)
  if (!entity) throw new Error('Project not found or not eligible')

  const [existing] = await db
    .select({ id: agentProjectBinding.id })
    .from(agentProjectBinding)
    .where(
      and(
        eq(agentProjectBinding.agentId, input.agentId),
        eq(agentProjectBinding.projectEntityId, input.projectEntityId),
      ),
    )
    .limit(1)
  if (existing) return { id: existing.id }

  const [row] = await db
    .insert(agentProjectBinding)
    .values({
      userId: input.userId,
      agentId: input.agentId,
      projectEntityId: input.projectEntityId,
    })
    .returning({ id: agentProjectBinding.id })

  if (!row) throw new Error('Failed to bind agent to project')
  return row
}

export async function unbindAgentFromProject(input: {
  userId: string
  agentId: string
  projectEntityId: string
}): Promise<void> {
  const db = getDb()
  const result = await db
    .delete(agentProjectBinding)
    .where(
      and(
        eq(agentProjectBinding.userId, input.userId),
        eq(agentProjectBinding.agentId, input.agentId),
        eq(agentProjectBinding.projectEntityId, input.projectEntityId),
      ),
    )
    .returning({ id: agentProjectBinding.id })
  if (result.length === 0) throw new Error('Project binding not found')
}

export async function listAgentProjectBindings(userId: string, agentId: string) {
  const db = getDb()
  return db
    .select({
      id: agentProjectBinding.id,
      projectEntityId: agentProjectBinding.projectEntityId,
      projectLabel: canonicalEntity.label,
      createdAt: agentProjectBinding.createdAt,
    })
    .from(agentProjectBinding)
    .innerJoin(canonicalEntity, eq(agentProjectBinding.projectEntityId, canonicalEntity.id))
    .where(and(eq(agentProjectBinding.userId, userId), eq(agentProjectBinding.agentId, agentId)))
    .orderBy(desc(agentProjectBinding.createdAt))
}

export async function replaceAgentProjectBindings(input: {
  userId: string
  agentId: string
  projectEntityIds: string[]
}): Promise<void> {
  const db = getDb()

  const [agent] = await db
    .select({ id: connectedAgent.id })
    .from(connectedAgent)
    .where(and(eq(connectedAgent.userId, input.userId), eq(connectedAgent.id, input.agentId)))
    .limit(1)
  if (!agent) throw new Error('Connected agent not found')

  await db
    .delete(agentProjectBinding)
    .where(
      and(
        eq(agentProjectBinding.userId, input.userId),
        eq(agentProjectBinding.agentId, input.agentId),
      ),
    )

  if (input.projectEntityIds.length === 0) return

  const eligibleEntities = await db
    .select({ id: canonicalEntity.id })
    .from(canonicalEntity)
    .where(
      and(
        eq(canonicalEntity.userId, input.userId),
        isNotNull(canonicalEntity.projectStatus),
        eq(canonicalEntity.entityType, 'project'),
      ),
    )
  const eligibleIds = new Set(eligibleEntities.map((e) => e.id))

  const validIds = input.projectEntityIds.filter((id) => eligibleIds.has(id))
  if (validIds.length === 0) return

  await db.insert(agentProjectBinding).values(
    validIds.map((projectEntityId) => ({
      userId: input.userId,
      agentId: input.agentId,
      projectEntityId,
    })),
  )
}

export { parseSubscribedEvents }
