import { v4 as uuidv4 } from 'uuid'
import { getDb } from '$lib/server/db'
import { connectedAgent, thought, thoughtEntity, canonicalEntity } from '$lib/server/db/schema'
import { eq, and } from 'drizzle-orm'
import { llmChatCompletion } from '$lib/server/llm/llm-client'
import { encryptTenantValue } from '$lib/server/crypto/tenant-encryption'

export type RunAgentInput = {
  userId: string
  agentId: string
  eventType: string
  payload: Record<string, unknown>
}

type WebhookPayload = Record<string, unknown>

export type RunAgentResult = {
  runId: string
  thoughtId?: string
  summary: string
}

/**
 * Run an agent with an inbound webhook event.
 * Creates a thought from the event and optionally processes it with the agent.
 */
export async function runAgentWithEvent(input: RunAgentInput): Promise<RunAgentResult> {
  const db = getDb()
  const runId = uuidv4()

  // Get agent config
  const [agent] = await db
    .select()
    .from(connectedAgent)
    .where(
      and(
        eq(connectedAgent.id, input.agentId),
        eq(connectedAgent.userId, input.userId),
        eq(connectedAgent.enabled, true),
      ),
    )
    .limit(1)

  if (!agent) {
    throw new Error(`Agent ${input.agentId} not found or disabled`)
  }

  // Create a thought from the webhook event
  const eventSummary = formatEventSummary(input.eventType, input.payload)
  const rawText = `[Webhook: ${input.eventType}] ${eventSummary}`

  // Encrypt if needed
  const rawTextEncrypted = await encryptTenantValue({
    userId: input.userId,
    table: 'thought',
    column: 'raw_text',
    plaintext: rawText,
  })

  const normalizedTextEncrypted = await encryptTenantValue({
    userId: input.userId,
    table: 'thought',
    column: 'normalized_text',
    plaintext: eventSummary,
  })

  const [thoughtRow] = await db
    .insert(thought)
    .values({
      userId: input.userId,
      rawText: `[webhook:${input.eventType}]`,
      rawTextEncrypted,
      normalizedText: eventSummary.slice(0, 500),
      normalizedTextEncrypted,
      category: 'observation',
      metadata: {
        source: 'inbound_webhook',
        eventType: input.eventType,
        agentId: input.agentId,
        runId,
      },
    })
    .returning({ id: thought.id })

  if (!thoughtRow) {
    throw new Error('Failed to create thought from webhook event')
  }

  // If agent has a webhook URL, we could forward the event
  // For now, we just store the thought and return

  return {
    runId,
    thoughtId: thoughtRow.id,
    summary: eventSummary,
  }
}

function formatEventSummary(eventType: string, payload: WebhookPayload): string {
  // Try to extract a meaningful summary from the payload
  if (typeof payload.summary === 'string') return payload.summary
  if (typeof payload.message === 'string') return payload.message
  if (typeof payload.text === 'string') return payload.text
  if (typeof payload.content === 'string') return payload.content

  // Fallback to event type + first few keys
  const keys = Object.keys(payload).slice(0, 3)
  if (keys.length === 0) return `Webhook event: ${eventType}`

  const preview = keys
    .map((k) => {
      const v = payload[k]
      if (typeof v === 'string') return v.slice(0, 100)
      if (typeof v === 'number' || typeof v === 'boolean') return String(v)
      return `[${typeof v}]`
    })
    .join(', ')

  return `${eventType}: ${preview}`
}
