import { scheduleAgentEvent } from './emit';

export function notifyThoughtCreated(input: {
	userId: string;
	thoughtId: string;
	normalizedText: string;
	source?: string | null;
	createdAt?: Date;
}): void {
	scheduleAgentEvent({
		userId: input.userId,
		eventType: 'thought.created',
		eventId: input.thoughtId,
		payload: {
			thoughtId: input.thoughtId,
			normalizedText: input.normalizedText,
			source: input.source ?? null,
			createdAt: (input.createdAt ?? new Date()).toISOString()
		}
	});
}

export function notifyThoughtEnriched(input: {
	userId: string;
	thoughtId: string;
	normalizedText: string;
	category: string;
	memoryType: string | null;
	enrichedAt: Date;
	entityCount?: number;
}): void {
	scheduleAgentEvent({
		userId: input.userId,
		eventType: 'thought.enriched',
		eventId: input.thoughtId,
		payload: {
			thoughtId: input.thoughtId,
			normalizedText: input.normalizedText,
			category: input.category,
			memoryType: input.memoryType,
			enrichedAt: input.enrichedAt.toISOString(),
			entityCount: input.entityCount ?? 0
		}
	});
}

export function notifyThoughtUpdated(input: {
	userId: string;
	thoughtId: string;
	normalizedText: string;
	category: string;
	memoryType?: string | null;
}): void {
	scheduleAgentEvent({
		userId: input.userId,
		eventType: 'thought.updated',
		eventId: input.thoughtId,
		payload: {
			thoughtId: input.thoughtId,
			normalizedText: input.normalizedText,
			category: input.category,
			memoryType: input.memoryType ?? null,
			updatedAt: new Date().toISOString()
		}
	});
}

export function notifyThoughtDeleted(input: { userId: string; thoughtId: string }): void {
	scheduleAgentEvent({
		userId: input.userId,
		eventType: 'thought.deleted',
		eventId: input.thoughtId,
		payload: {
			thoughtId: input.thoughtId,
			deletedAt: new Date().toISOString()
		}
	});
}
