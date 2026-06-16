import { and, eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { canonicalEntity, projectProfile, type ProjectStatus } from '$lib/server/db/schema';
import { loadGroundingProfileForEnrichment } from '$lib/server/grounding/profile';
import { llmChatCompletion } from '$lib/server/llm/llm-client';
import { stripMarkdownJsonFences } from '$lib/server/memory/llm-json-content';
import {
	designateNextAction,
	linkThoughtToProject
} from '$lib/server/memory/project-next-action';
import { validateNonEmptyEntityId } from '$lib/server/validation/mcp-args';

export type GtdProjectOption = {
	entityId: string;
	label: string;
	status: ProjectStatus;
};

export type GtdAssignmentExtraction = {
	projectEntityId: string | null;
	isNextAction: boolean;
};

export type GtdAssignmentResult = {
	projectEntityId: string | null;
	projectLabel: string | null;
	isNextAction: boolean;
};

function extractChatContent(response: unknown): string {
	const choices = (response as { choices?: Array<{ message?: { content?: string } }> }).choices;
	const content = choices?.[0]?.message?.content;
	if (typeof content !== 'string') {
		throw new Error('extractGtdAssignment: missing LLM content');
	}
	return content;
}

export async function loadGtdProjectOptions(userId: string): Promise<GtdProjectOption[]> {
	const rows = await getDb()
		.select({
			entityId: canonicalEntity.id,
			label: canonicalEntity.label,
			status: projectProfile.status
		})
		.from(canonicalEntity)
		.leftJoin(
			projectProfile,
			and(
				eq(projectProfile.projectEntityId, canonicalEntity.id),
				eq(projectProfile.userId, userId)
			)
		)
		.where(and(eq(canonicalEntity.userId, userId), eq(canonicalEntity.entityType, 'project')));

	return rows.map((row) => ({
		entityId: row.entityId,
		label: row.label,
		status: (row.status ?? 'active') as ProjectStatus
	}));
}

export function parseGtdAssignmentPayload(
	raw: unknown,
	allowedProjectIds: Set<string>
): GtdAssignmentExtraction {
	if (!raw || typeof raw !== 'object') {
		return { projectEntityId: null, isNextAction: false };
	}
	const obj = raw as Record<string, unknown>;
	const projectRaw =
		typeof obj.projectEntityId === 'string'
			? obj.projectEntityId
			: typeof obj.project_entity_id === 'string'
				? obj.project_entity_id
				: null;
	const projectEntityId =
		projectRaw && allowedProjectIds.has(validateNonEmptyEntityId(projectRaw, 'projectEntityId'))
			? validateNonEmptyEntityId(projectRaw, 'projectEntityId')
			: null;
	const isNextAction = obj.isNextAction === true || obj.is_next_action === true;
	return { projectEntityId, isNextAction };
}

export async function extractGtdAssignment(input: {
	userId: string;
	normalizedText: string;
	projects: GtdProjectOption[];
	groundingProjectsFacet?: string | null;
}): Promise<GtdAssignmentExtraction> {
	if (input.projects.length === 0) {
		return { projectEntityId: null, isNextAction: false };
	}

	const projectCatalog = input.projects
		.map((p) => `- ${p.entityId}: ${p.label} (${p.status})`)
		.join('\n');

	const prompt = [
		'Return ONLY JSON with this shape:',
		'{',
		'  "projectEntityId": "uuid from catalog or null",',
		'  "isNextAction": true|false',
		'}',
		'',
		'Decide whether this note belongs to one of the user projects and whether it is the concrete next action for that project (GTD).',
		'Use projectEntityId null when no project clearly applies.',
		'isNextAction should be true only when the text is a specific actionable next step for the chosen project.',
		'',
		'Project catalog:',
		projectCatalog,
		input.groundingProjectsFacet?.trim()
			? `\nGrounding projects context:\n${input.groundingProjectsFacet.trim()}`
			: '',
		'',
		`Note: ${input.normalizedText}`
	]
		.filter((line) => line.length > 0)
		.join('\n');

	const response = await llmChatCompletion({
		userId: input.userId,
		messages: [
			{
				role: 'system',
				content:
					'You assign personal notes to GTD projects. projectEntityId must be copied exactly from the catalog or null. Return only valid JSON.'
			},
			{ role: 'user', content: prompt }
		],
		temperature: 0
	});

	const parsed = JSON.parse(stripMarkdownJsonFences(extractChatContent(response))) as unknown;
	const allowed = new Set(input.projects.map((p) => p.entityId));
	return parseGtdAssignmentPayload(parsed, allowed);
}

export async function applyGtdAssignment(input: {
	userId: string;
	thoughtId: string;
	normalizedText: string;
	memoryType: string | null;
	category: string;
}): Promise<GtdAssignmentResult | null> {
	if (input.memoryType !== 'open_loop' && input.category !== 'task') {
		return null;
	}

	const projects = (await loadGtdProjectOptions(input.userId)).filter((p) => p.status === 'active');
	if (projects.length === 0) return null;

	const grounding = await loadGroundingProfileForEnrichment(input.userId);
	const groundingProjectsFacet = grounding?.facets.projects ?? null;

	const assignment = await extractGtdAssignment({
		userId: input.userId,
		normalizedText: input.normalizedText,
		projects,
		groundingProjectsFacet
	});

	if (!assignment.projectEntityId) {
		return { projectEntityId: null, projectLabel: null, isNextAction: false };
	}

	const project = projects.find((p) => p.entityId === assignment.projectEntityId);
	if (!project) {
		return { projectEntityId: null, projectLabel: null, isNextAction: false };
	}

	await linkThoughtToProject(input.userId, project.entityId, input.thoughtId);

	if (assignment.isNextAction) {
		await designateNextAction(input.userId, project.entityId, input.thoughtId);
	}

	return {
		projectEntityId: project.entityId,
		projectLabel: project.label,
		isNextAction: assignment.isNextAction
	};
}
