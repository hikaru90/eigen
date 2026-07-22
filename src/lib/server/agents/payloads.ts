import { stripEmbeddingsFromValue } from '$lib/server/observability/strip-embeddings'

export type ThoughtWebhookPayload = {
  thoughtId: string
  normalizedText?: string
  rawText?: string
  category?: string
  memoryType?: string | null
  source?: string | null
  createdAt?: string
  enrichedAt?: string | null
  updatedAt?: string
  entityCount?: number
  projectEntityIds?: string[]
  projectLabels?: string[]
}

export type TaskAssignedPayload = {
  assignmentId: string
  thoughtId: string
  normalizedText: string
  category: string
  memoryType: string | null
  projectEntityId?: string | null
  projectLabel?: string | null
}

export function sanitizeWebhookPayload<T extends Record<string, unknown>>(payload: T): T {
  return stripEmbeddingsFromValue(payload) as T
}

export function buildEnvelope(input: {
  eventType: string
  eventId: string
  payload: Record<string, unknown>
}): Record<string, unknown> {
  return sanitizeWebhookPayload({
    event: input.eventType,
    // Hermes body detector looks for event_type / type; keep event as canonical.
    event_type: input.eventType,
    eventId: input.eventId,
    timestamp: new Date().toISOString(),
    data: input.payload,
  })
}
