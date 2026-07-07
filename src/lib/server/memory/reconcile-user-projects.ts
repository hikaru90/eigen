import { and, eq, isNotNull } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { canonicalEntity } from '$lib/server/db/schema';
import { llmChatCompletion } from '$lib/server/llm/llm-client';
import { stripMarkdownJsonFences } from '$lib/server/memory/llm-json-content';
import { loadHubJudgmentContext } from '$lib/server/memory/judge-gtd-project';
import { countOpenTasksForProjectEntity, demoteProject } from '$lib/server/memory/project-eligibility';
import {
	GTD_PROJECT_STAY_SEPARATE_POLICY,
	loadProjectIdentityContext,
	mergeProjectEntities,
	type ProjectIdentityContext
} from '$lib/server/memory/resolve-project-identity';

export type ReconcileUserProjectsResult = {
	merged: number;
	demoted: number;
};

function extractChatContent(response: unknown): string {
	const choices = (response as { choices?: Array<{ message?: { content?: string } }> }).choices;
	const content = choices?.[0]?.message?.content;
	if (typeof content !== 'string') {
		throw new Error('reconcileUserProjects: missing LLM content');
	}
	return content;
}

export function buildReconcilePrompt(
	profiles: Array<{
		entityId: string;
		label: string;
		openTaskCount: number;
		linkedThoughtSummaries: string[];
	}>,
	context?: Pick<ProjectIdentityContext, 'hubCandidates' | 'graphNeighborPairs'>
): string {
	const profileLines = profiles
		.map((p) => {
			const thoughts =
				p.linkedThoughtSummaries.length > 0
					? p.linkedThoughtSummaries.map((s) => `      - ${s}`).join('\n')
					: '      (none)';
			return [
				`- ${p.entityId}: ${p.label} (${p.openTaskCount} open tasks)`,
				'    linkedThoughts:',
				thoughts
			].join('\n');
		})
		.join('\n');

	const hubs = context?.hubCandidates
		.map(
			(h) =>
				`- ${h.entityId}: ${h.label} [${h.entityType}] mentions=${h.mentionCount}${
					h.linkedThoughtSummaries.length > 0
						? ` thoughts: ${h.linkedThoughtSummaries.join(' | ')}`
						: ''
				}`
		)
		.join('\n');
	const neighbors = context?.graphNeighborPairs
		.map((e) => `- ${e.sourceLabel} --${e.predicate}--> ${e.targetLabel}`)
		.join('\n');

	return [
		'Return ONLY JSON:',
		'{',
		'  "mergeGroups": [',
		'    { "winnerEntityId": "uuid", "loserEntityIds": ["uuid"], "canonicalLabel": "name" }',
		'  ],',
		'  "demoteEntityIds": ["uuid"]',
		'}',
		'',
		'Merge duplicate GTD project variants (same initiative, different labels) into one winner.',
		...GTD_PROJECT_STAY_SEPARATE_POLICY,
		'Demote entity ids that are NOT real multi-step GTD projects (ingredients, people, books, parts, single chores).',
		'Use linked thought text — not counts alone — to decide meaning.',
		'Copy UUIDs exactly from the catalog.',
		'',
		profiles.length > 0 ? `GTD project profiles:\n${profileLines}` : 'GTD project profiles: (none)',
		hubs ? `\nGraph hub candidates:\n${hubs}` : '',
		neighbors ? `\nEntity graph neighbors:\n${neighbors}` : ''
	]
		.filter((line) => line.length > 0)
		.join('\n');
}

export function parseReconcilePayload(raw: unknown, allowedEntityIds: Set<string>): {
	mergeGroups: Array<{ winnerEntityId: string; loserEntityIds: string[]; canonicalLabel: string }>;
	demoteEntityIds: string[];
} {
	if (!raw || typeof raw !== 'object') {
		return { mergeGroups: [], demoteEntityIds: [] };
	}
	const obj = raw as Record<string, unknown>;
	const mergeGroups: Array<{
		winnerEntityId: string;
		loserEntityIds: string[];
		canonicalLabel: string;
	}> = [];
	const mergeRaw = obj.mergeGroups ?? obj.merge_groups;
	if (Array.isArray(mergeRaw)) {
		for (const entry of mergeRaw) {
			if (!entry || typeof entry !== 'object') continue;
			const winnerRaw =
				typeof (entry as { winnerEntityId?: unknown }).winnerEntityId === 'string'
					? (entry as { winnerEntityId: string }).winnerEntityId
					: typeof (entry as { winner_entity_id?: unknown }).winner_entity_id === 'string'
						? (entry as { winner_entity_id: string }).winner_entity_id
						: null;
			if (!winnerRaw || !allowedEntityIds.has(winnerRaw)) continue;
			const labelRaw =
				typeof (entry as { canonicalLabel?: unknown }).canonicalLabel === 'string'
					? (entry as { canonicalLabel: string }).canonicalLabel.trim()
					: typeof (entry as { canonical_label?: unknown }).canonical_label === 'string'
						? (entry as { canonical_label: string }).canonical_label.trim()
						: '';
			const losersRaw =
				(entry as { loserEntityIds?: unknown }).loserEntityIds ??
				(entry as { loser_entity_ids?: unknown }).loser_entity_ids;
			const loserEntityIds: string[] = [];
			if (Array.isArray(losersRaw)) {
				for (const loser of losersRaw) {
					if (typeof loser === 'string' && allowedEntityIds.has(loser) && loser !== winnerRaw) {
						loserEntityIds.push(loser);
					}
				}
			}
			if (loserEntityIds.length === 0) continue;
			mergeGroups.push({
				winnerEntityId: winnerRaw,
				loserEntityIds,
				canonicalLabel: labelRaw
			});
		}
	}

	const demoteEntityIds: string[] = [];
	const demoteRaw = obj.demoteEntityIds ?? obj.demote_entity_ids;
	if (Array.isArray(demoteRaw)) {
		for (const id of demoteRaw) {
			if (typeof id === 'string' && allowedEntityIds.has(id)) {
				demoteEntityIds.push(id);
			}
		}
	}

	return { mergeGroups, demoteEntityIds };
}

export async function reconcileUserProjects(userId: string): Promise<ReconcileUserProjectsResult> {
	const profileRows = await getDb()
		.select({
			entityId: canonicalEntity.id,
			label: canonicalEntity.label
		})
		.from(canonicalEntity)
		.where(
			and(
				eq(canonicalEntity.userId, userId),
				isNotNull(canonicalEntity.projectStatus),
				eq(canonicalEntity.projectSource, 'capture')
			)
		);

	if (profileRows.length < 2) {
		return { merged: 0, demoted: 0 };
	}

	const profilesWithContext = await Promise.all(
		profileRows.map(async (row) => {
			const ctx = await loadHubJudgmentContext(userId, row.entityId);
			return {
				entityId: row.entityId,
				label: row.label,
				openTaskCount: ctx?.openTaskCount ?? (await countOpenTasksForProjectEntity(userId, row.entityId)),
				linkedThoughtSummaries: ctx?.linkedThoughtSummaries ?? []
			};
		})
	);

	const context = await loadProjectIdentityContext(userId);
	const allowedEntityIds = new Set(profileRows.map((r) => r.entityId));
	for (const hub of context.hubCandidates) {
		allowedEntityIds.add(hub.entityId);
	}

	let merged = 0;
	let demoted = 0;

	const response = await llmChatCompletion({
		userId,
		messages: [
			{
				role: 'system',
				content:
					'You reconcile duplicate GTD projects and demote false-positive hubs. Merge only same-initiative name variants; keep distinct initiatives separate. Return only valid JSON.'
			},
			{ role: 'user', content: buildReconcilePrompt(profilesWithContext, context) }
		],
		temperature: 0
	});

	const parsed = JSON.parse(stripMarkdownJsonFences(extractChatContent(response))) as unknown;
	const { mergeGroups, demoteEntityIds } = parseReconcilePayload(parsed, allowedEntityIds);

	for (const group of mergeGroups) {
		await mergeProjectEntities(
			userId,
			group.winnerEntityId,
			group.loserEntityIds,
			group.canonicalLabel || undefined
		);
		merged += group.loserEntityIds.length;
	}

	for (const entityId of demoteEntityIds) {
		const [stillExists] = await getDb()
			.select({ id: canonicalEntity.id })
			.from(canonicalEntity)
			.where(
				and(
					eq(canonicalEntity.userId, userId),
					eq(canonicalEntity.id, entityId),
					isNotNull(canonicalEntity.projectStatus)
				)
			)
			.limit(1);
		if (!stillExists) continue;
		const didDemote = await demoteProject(userId, entityId);
		if (didDemote) demoted += 1;
	}

	return { merged, demoted };
}
