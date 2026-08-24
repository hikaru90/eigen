import {
  AGENT_SUBSCRIBABLE_EVENTS as SHARED_SUBSCRIBABLE,
  AGENT_EVENT_LABELS as SHARED_LABELS,
} from '$lib/agents/constants'
import type { AgentSubscribableEventType, AgentWebhookEventType } from '$lib/server/db/schema'

export const WEBHOOK_DELIVERY_JOB = 'webhook_delivery' as const

export const WEBHOOK_HTTP_TIMEOUT_MS = 10_000

export const WEBHOOK_MAX_ATTEMPTS = 3

export const AGENT_SUBSCRIBABLE_EVENTS: AgentSubscribableEventType[] = [...SHARED_SUBSCRIBABLE]

export const AGENT_EVENT_LABELS: Record<AgentWebhookEventType, string> = {
  'thought.created': SHARED_LABELS['thought.created'],
  'thought.enriched': SHARED_LABELS['thought.enriched'],
  'thought.updated': SHARED_LABELS['thought.updated'],
  'thought.deleted': SHARED_LABELS['thought.deleted'],
  'agent.task.assigned': SHARED_LABELS['agent.task.assigned'],
  'webhook.test': SHARED_LABELS['webhook.test'],
}
