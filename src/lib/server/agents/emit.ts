import { and, eq, inArray } from 'drizzle-orm';
import { appSql, createScopedDrizzle, activateTenantDbSession, deactivateTenantDbSession } from '$lib/server/db';
import {
	connectedAgent,
	webhookDelivery,
	agentProjectBinding,
	type AgentSubscribableEventType,
	type AgentWebhookEventType
} from '$lib/server/db/schema';
import { enqueueUserJob } from '$lib/server/job-queue/enqueue';
import { WEBHOOK_DELIVERY_JOB, WEBHOOK_MAX_ATTEMPTS } from './constants';
import { buildEnvelope } from './payloads';

export type EmitAgentEventInput = {
	userId: string;
	eventType: AgentWebhookEventType;
	eventId: string;
	payload: Record<string, unknown>;
	/** When set, deliver only to this agent (e.g. task assignment). */
	agentId?: string;
	/** Project entity IDs this event belongs to — used to filter project-bound agents. */
	projectEntityIds?: string[];
};

function agentMatchesEvent(
	agent: { subscribedEvents: AgentSubscribableEventType[] },
	eventType: AgentWebhookEventType
): boolean {
	if (eventType === 'agent.task.assigned' || eventType === 'webhook.test') {
		return true;
	}
	return agent.subscribedEvents.includes(eventType as AgentSubscribableEventType);
}

export async function emitAgentEvent(input: EmitAgentEventInput): Promise<{ deliveries: number }> {
	// This function is often called fire-and-forget after the request handler completes,
	// at which point the tenant DB session has been deactivated. We need our own connection
	// with the RLS GUC set so we can read/write RLS-scoped tables.
	const reserved = await appSql.reserve();
	try {
		await activateTenantDbSession(reserved, input.userId);
		const db = createScopedDrizzle(reserved);

		const agents = input.agentId
			? await db
					.select({
						id: connectedAgent.id,
						subscribedEvents: connectedAgent.subscribedEvents,
						enabled: connectedAgent.enabled
					})
					.from(connectedAgent)
					.where(
						and(
							eq(connectedAgent.userId, input.userId),
							eq(connectedAgent.id, input.agentId),
							eq(connectedAgent.enabled, true)
						)
					)
			: await db
					.select({
						id: connectedAgent.id,
						subscribedEvents: connectedAgent.subscribedEvents,
						enabled: connectedAgent.enabled
					})
					.from(connectedAgent)
					.where(
						and(eq(connectedAgent.userId, input.userId), eq(connectedAgent.enabled, true))
					);

		if (agents.length === 0) return { deliveries: 0 };

		const agentIds = agents.map((a) => a.id);
		const bindings = await db
			.select({
				agentId: agentProjectBinding.agentId,
				projectEntityId: agentProjectBinding.projectEntityId
			})
			.from(agentProjectBinding)
			.where(inArray(agentProjectBinding.agentId, agentIds));

		const bindingsByAgent = new Map<string, Set<string>>();
		for (const b of bindings) {
			let set = bindingsByAgent.get(b.agentId);
			if (!set) {
				set = new Set();
				bindingsByAgent.set(b.agentId, set);
			}
			set.add(b.projectEntityId);
		}

		const envelope = buildEnvelope({
			eventType: input.eventType,
			eventId: input.eventId,
			payload: input.payload
		});

		let deliveries = 0;

		for (const agent of agents) {
			if (!input.agentId && !agentMatchesEvent(agent, input.eventType)) {
				continue;
			}

			const agentBindings = bindingsByAgent.get(agent.id);
			if (agentBindings && agentBindings.size > 0) {
				const isSpecialEvent =
					input.eventType === 'agent.task.assigned' || input.eventType === 'webhook.test';
				if (!isSpecialEvent) {
					if (!input.projectEntityIds || input.projectEntityIds.length === 0) {
						continue;
					}
					const hasOverlap = input.projectEntityIds.some((pid) => agentBindings.has(pid));
					if (!hasOverlap) continue;
				}
			}

			const [delivery] = await db
				.insert(webhookDelivery)
				.values({
					userId: input.userId,
					agentId: agent.id,
					eventType: input.eventType,
					eventId: input.eventId,
					payload: envelope,
					status: 'pending'
				})
				.returning({ id: webhookDelivery.id });

			if (!delivery) continue;

			const dedupeKey = `webhook:${agent.id}:${input.eventType}:${input.eventId}`;
			const enqueued = await enqueueUserJob({
				userId: input.userId,
				jobType: WEBHOOK_DELIVERY_JOB,
				runAfter: new Date(),
				dedupeKey,
				payload: { deliveryId: delivery.id },
				maxAttempts: WEBHOOK_MAX_ATTEMPTS
			});

			if (enqueued.enqueued) {
				deliveries += 1;
			}
		}

		return { deliveries };
	} catch (err) {
		console.error('[agents.emit] failed (non-blocking)', {
			userId: input.userId,
			eventType: input.eventType,
			eventId: input.eventId,
			message: err instanceof Error ? err.message : String(err)
		});
		return { deliveries: 0 };
	} finally {
		await deactivateTenantDbSession(reserved).catch(() => {});
		await reserved.release();
	}
}

/** Fire-and-forget wrapper for ingest paths — never throws. */
export function scheduleAgentEvent(input: EmitAgentEventInput): void {
	void emitAgentEvent(input);
}
