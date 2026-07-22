import { scheduleAgentEvent } from './emit'

export function notifyThoughtCreated(input: {
  userId: string
  thoughtId: string
  normalizedText: string
  source?: string | null
  createdAt?: Date
  projectEntityIds?: string[]
  projectLabels?: string[]
}): void {
  scheduleAgentEvent({
    userId: input.userId,
    eventType: 'thought.created',
    eventId: input.thoughtId,
    projectEntityIds: input.projectEntityIds,
    payload: {
      thoughtId: input.thoughtId,
      normalizedText: input.normalizedText,
      source: input.source ?? null,
      createdAt: (input.createdAt ?? new Date()).toISOString(),
      ...(input.projectEntityIds && input.projectEntityIds.length > 0
        ? { projectEntityIds: input.projectEntityIds, projectLabels: input.projectLabels ?? [] }
        : {}),
    },
  })
}

export function notifyThoughtEnriched(input: {
  userId: string
  thoughtId: string
  normalizedText: string
  category: string
  memoryType: string | null
  enrichedAt: Date
  entityCount?: number
  projectEntityIds?: string[]
  projectLabels?: string[]
}): void {
  scheduleAgentEvent({
    userId: input.userId,
    eventType: 'thought.enriched',
    eventId: input.thoughtId,
    projectEntityIds: input.projectEntityIds,
    payload: {
      thoughtId: input.thoughtId,
      normalizedText: input.normalizedText,
      category: input.category,
      memoryType: input.memoryType,
      enrichedAt: input.enrichedAt.toISOString(),
      entityCount: input.entityCount ?? 0,
      ...(input.projectEntityIds && input.projectEntityIds.length > 0
        ? { projectEntityIds: input.projectEntityIds, projectLabels: input.projectLabels ?? [] }
        : {}),
    },
  })
}

export function notifyThoughtUpdated(input: {
  userId: string
  thoughtId: string
  normalizedText: string
  category: string
  memoryType?: string | null
  projectEntityIds?: string[]
  projectLabels?: string[]
}): void {
  scheduleAgentEvent({
    userId: input.userId,
    eventType: 'thought.updated',
    eventId: input.thoughtId,
    projectEntityIds: input.projectEntityIds,
    payload: {
      thoughtId: input.thoughtId,
      normalizedText: input.normalizedText,
      category: input.category,
      memoryType: input.memoryType ?? null,
      updatedAt: new Date().toISOString(),
      ...(input.projectEntityIds && input.projectEntityIds.length > 0
        ? { projectEntityIds: input.projectEntityIds, projectLabels: input.projectLabels ?? [] }
        : {}),
    },
  })
}

export function notifyThoughtDeleted(input: {
  userId: string
  thoughtId: string
  projectEntityIds?: string[]
  projectLabels?: string[]
}): void {
  scheduleAgentEvent({
    userId: input.userId,
    eventType: 'thought.deleted',
    eventId: input.thoughtId,
    projectEntityIds: input.projectEntityIds,
    payload: {
      thoughtId: input.thoughtId,
      deletedAt: new Date().toISOString(),
      ...(input.projectEntityIds && input.projectEntityIds.length > 0
        ? { projectEntityIds: input.projectEntityIds, projectLabels: input.projectLabels ?? [] }
        : {}),
    },
  })
}
