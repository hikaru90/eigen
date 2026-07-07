import { and, eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
	agentTaskAssignment,
	connectedAgent,
	agentProjectBinding,
	thought,
	type AgentTaskAssignmentStatus
} from '$lib/server/db/schema';
import { emitAgentEvent } from './emit';
import { loadProjectContextForThought } from './project-context';

export type AssignThoughtToAgentResult = {
	assignmentId: string;
	agentId: string;
	agentName: string;
	thoughtId: string;
	status: AgentTaskAssignmentStatus;
};

export async function assignThoughtToAgent(input: {
	userId: string;
	agentId: string;
	thoughtId: string;
}): Promise<AssignThoughtToAgentResult> {
	const db = getDb();

	const [agent] = await db
		.select({ id: connectedAgent.id, name: connectedAgent.name, enabled: connectedAgent.enabled })
		.from(connectedAgent)
		.where(and(eq(connectedAgent.userId, input.userId), eq(connectedAgent.id, input.agentId)))
		.limit(1);

	if (!agent) {
		throw new Error('Connected agent not found');
	}
	if (!agent.enabled) {
		throw new Error('Connected agent is disabled');
	}

	const [thoughtRow] = await db
		.select({
			id: thought.id,
			normalizedText: thought.normalizedText,
			category: thought.category,
			memoryType: thought.memoryType,
			lifecycleStatus: thought.lifecycleStatus
		})
		.from(thought)
		.where(and(eq(thought.userId, input.userId), eq(thought.id, input.thoughtId)))
		.limit(1);

	if (!thoughtRow) {
		throw new Error('Thought not found');
	}

	if (thoughtRow.category !== 'task') {
		throw new Error('Only task thoughts can be assigned to agents');
	}

	if (thoughtRow.lifecycleStatus !== 'open') {
		throw new Error('Only open tasks can be assigned to agents');
	}

	const projectCtx = await loadProjectContextForThought(input.userId, input.thoughtId);

	if (projectCtx.projectEntityIds.length > 0) {
		const bindings = await db
			.select({ projectEntityId: agentProjectBinding.projectEntityId })
			.from(agentProjectBinding)
			.where(eq(agentProjectBinding.agentId, agent.id));

		if (bindings.length > 0) {
			const agentBoundProjects = new Set(bindings.map((b) => b.projectEntityId));
			const hasOverlap = projectCtx.projectEntityIds.some((pid) => agentBoundProjects.has(pid));
			if (!hasOverlap) {
				throw new Error(
					'Agent is not bound to any of the projects this thought belongs to'
				);
			}
		}
	}

	const [assignment] = await db
		.insert(agentTaskAssignment)
		.values({
			userId: input.userId,
			agentId: input.agentId,
			thoughtId: input.thoughtId,
			status: 'pending'
		})
		.returning({ id: agentTaskAssignment.id });

	if (!assignment) {
		throw new Error('Failed to create task assignment');
	}

	await emitAgentEvent({
		userId: input.userId,
		agentId: input.agentId,
		eventType: 'agent.task.assigned',
		eventId: assignment.id,
		projectEntityIds: projectCtx.projectEntityIds,
		payload: {
			assignmentId: assignment.id,
			thoughtId: thoughtRow.id,
			normalizedText: thoughtRow.normalizedText,
			category: thoughtRow.category,
			memoryType: thoughtRow.memoryType,
			projectEntityId: projectCtx.projectEntityIds[0] ?? null,
			projectLabel: projectCtx.projectLabels[0] ?? null
		}
	});

	await db
		.update(agentTaskAssignment)
		.set({ status: 'delivered' })
		.where(eq(agentTaskAssignment.id, assignment.id));

	return {
		assignmentId: assignment.id,
		agentId: agent.id,
		agentName: agent.name,
		thoughtId: thoughtRow.id,
		status: 'delivered'
	};
}
