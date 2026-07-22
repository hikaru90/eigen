export const AGENT_SUBSCRIBABLE_EVENTS = [
  'thought.created',
  'thought.enriched',
  'thought.updated',
  'thought.deleted',
] as const

export type AgentSubscribableEventClient = (typeof AGENT_SUBSCRIBABLE_EVENTS)[number]

export const AGENT_EVENT_LABELS: Record<string, string> = {
  'thought.created': 'Thought created',
  'thought.enriched': 'Thought enriched',
  'thought.updated': 'Thought updated',
  'thought.deleted': 'Thought deleted',
  'agent.task.assigned': 'Task assigned',
  'webhook.test': 'Test ping',
}
