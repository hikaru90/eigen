import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
	canonicalEntity,
	projectProfile,
	thought,
	thoughtEntity
} from '$lib/server/db/schema';
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption';
import { llmChatCompletion } from '$lib/server/llm/llm-client';
import { stripMarkdownJsonFences } from '$lib/server/memory/llm-json-content';
import { m } from '$lib/paraglide/messages.js';
import {
	countLinkedThoughtsForProjectEntity,
	countOpenTasksForProjectEntity
} from '$lib/server/memory/project-eligibility';
import { validateNonEmptyEntityId } from '$lib/server/validation/mcp-args';

export type GtdProjectJudgment = {
	isGtdProject: boolean;
	canonicalLabel: string;
};

export type HubJudgmentContext = {
	entityId: string;
	label: string;
	entityType: string;
	linkedThoughtCount: number;
	openTaskCount: number;
	linkedThoughtSummaries: string[];
	openTaskSummaries: string[];
};

function extractChatContent(response: unknown): string {
	const choices = (response as { choices?: Array<{ message?: { content?: string } }> }).choices;
	const content = choices?.[0]?.message?.content;
	if (typeof content !== 'string') {
		throw new Error('judgeGtdProjectHub: missing LLM content');
	}
	return content;
}

async function summarizeThoughtRow(
	userId: string,
	row: { normalizedText: string | null; normalizedTextEncrypted: string | null }
): Promise<string | null> {
	const text = row.normalizedTextEncrypted
		? await decryptTenantValue({
				userId,
				table: 'thought',
				column: 'normalized_text',
				ciphertext: row.normalizedTextEncrypted
			})
		: row.normalizedText;
	const trimmed = text?.trim() ?? '';
	if (!trimmed) return null;
	return trimmed.length > 160 ? `${trimmed.slice(0, 157).trim()}…` : trimmed;
}

export async function loadHubJudgmentContext(
	userId: string,
	entityId: string
): Promise<HubJudgmentContext | null> {
	const id = validateNonEmptyEntityId(entityId, 'entityId');
	const [entity] = await getDb()
		.select({
			label: canonicalEntity.label,
			entityType: canonicalEntity.entityType
		})
		.from(canonicalEntity)
		.where(and(eq(canonicalEntity.userId, userId), eq(canonicalEntity.id, id)))
		.limit(1);
	if (!entity) return null;

	const thoughtRows = await getDb()
		.select({
			normalizedText: thought.normalizedText,
			normalizedTextEncrypted: thought.normalizedTextEncrypted,
			category: thought.category
		})
		.from(thoughtEntity)
		.innerJoin(thought, eq(thoughtEntity.thoughtId, thought.id))
		.where(and(eq(thoughtEntity.userId, userId), eq(thoughtEntity.entityId, id)))
		.orderBy(sql`${thought.createdAt} desc`)
		.limit(12);

	const linkedThoughtSummaries: string[] = [];
	const openTaskSummaries: string[] = [];
	for (const row of thoughtRows) {
		const summary = await summarizeThoughtRow(userId, row);
		if (!summary) continue;
		if (linkedThoughtSummaries.length < 8) {
			linkedThoughtSummaries.push(summary);
		}
		if (row.category === 'task' && openTaskSummaries.length < 6) {
			openTaskSummaries.push(summary);
		}
	}

	const linkedThoughtCount = await countLinkedThoughtsForProjectEntity(userId, id);
	const openTaskCount = await countOpenTasksForProjectEntity(userId, id);

	return {
		entityId: id,
		label: entity.label,
		entityType: entity.entityType,
		linkedThoughtCount,
		openTaskCount,
		linkedThoughtSummaries,
		openTaskSummaries
	};
}

/** Structural pre-check: enough evidence to spend an LLM call (does not decide meaning). */
export function shouldInvokeGtdProjectJudge(input: {
	linkedThoughtCount: number;
	openTaskCount: number;
	force?: boolean;
}): boolean {
	if (input.force) return true;
	if (input.openTaskCount >= 2) return true;
	if (input.linkedThoughtCount >= 2 && input.openTaskCount >= 1) return true;
	if (input.linkedThoughtCount >= 3) return true;
	return false;
}

export function parseGtdProjectJudgmentPayload(
	raw: unknown,
	fallbackLabel: string
): GtdProjectJudgment {
	if (!raw || typeof raw !== 'object') {
		return { isGtdProject: false, canonicalLabel: fallbackLabel };
	}
	const obj = raw as Record<string, unknown>;
	const isGtdProject = obj.isGtdProject === true || obj.is_gtd_project === true;
	const canonicalLabel =
		typeof obj.canonicalLabel === 'string' && obj.canonicalLabel.trim()
			? obj.canonicalLabel.trim()
			: typeof obj.canonical_label === 'string' && obj.canonical_label.trim()
				? obj.canonical_label.trim()
				: fallbackLabel;
	return { isGtdProject, canonicalLabel };
}

function buildJudgePrompt(context: HubJudgmentContext): string {
	const linked = context.linkedThoughtSummaries.length
		? context.linkedThoughtSummaries.map((s) => `- ${s}`).join('\n')
		: '(none)';
	const tasks = context.openTaskSummaries.length
		? context.openTaskSummaries.map((s) => `- ${s}`).join('\n')
		: '(none)';

	return [
		'Return ONLY JSON:',
		'{ "isGtdProject": true|false, "canonicalLabel": "best display name for the initiative" }',
		'',
		'Decide whether this graph hub is a GTD **project**: a multi-step body of work / initiative',
		'that multiple captured thoughts or tasks point to as one connecting thing.',
		'',
		'NOT a GTD project: ingredients or food items, people, book/media titles, product parts,',
		'places, abbreviations, domains, concepts mentioned in passing, or a single one-off chore',
		'with only one actionable task and no ongoing initiative (e.g. one tax filing).',
		'',
		'YES examples: a product build, app, research initiative, ongoing work stream with several tasks.',
		'Use linked thought text — not mention counts alone — to decide meaning.',
		'',
		`Hub label: ${context.label}`,
		`Entity type (ontology): ${context.entityType}`,
		`Stats (context only): ${context.linkedThoughtCount} linked thoughts, ${context.openTaskCount} open tasks`,
		'',
		'Linked thoughts:',
		linked,
		'',
		'Open tasks / open loops:',
		tasks
	].join('\n');
}

export async function judgeGtdProjectHub(
	userId: string,
	entityId: string,
	options?: { force?: boolean }
): Promise<GtdProjectJudgment | null> {
	const context = await loadHubJudgmentContext(userId, entityId);
	if (!context) return null;

	if (
		!shouldInvokeGtdProjectJudge({
			linkedThoughtCount: context.linkedThoughtCount,
			openTaskCount: context.openTaskCount,
			force: options?.force
		})
	) {
		return { isGtdProject: false, canonicalLabel: context.label };
	}

	const response = await llmChatCompletion({
		userId,
		messages: [
			{
				role: 'system',
				content: m.llm_gtd_judge_system()
			},
			{ role: 'user', content: buildJudgePrompt(context) }
		],
		temperature: 0
	});

	const parsed = JSON.parse(stripMarkdownJsonFences(extractChatContent(response))) as unknown;
	return parseGtdProjectJudgmentPayload(parsed, context.label);
}

export function parseGtdProjectAuditBatchPayload(
	raw: unknown,
	allowedEntityIds: Set<string>
): Array<{ entityId: string; isGtdProject: boolean; canonicalLabel: string }> {
	if (!raw || typeof raw !== 'object') return [];
	const resultsRaw = (raw as { results?: unknown }).results;
	if (!Array.isArray(resultsRaw)) return [];

	const out: Array<{ entityId: string; isGtdProject: boolean; canonicalLabel: string }> = [];
	for (const entry of resultsRaw) {
		if (!entry || typeof entry !== 'object') continue;
		const idRaw =
			typeof (entry as { entityId?: unknown }).entityId === 'string'
				? (entry as { entityId: string }).entityId
				: typeof (entry as { entity_id?: unknown }).entity_id === 'string'
					? (entry as { entity_id: string }).entity_id
					: null;
		if (!idRaw || !allowedEntityIds.has(idRaw)) continue;
		const isGtdProject =
			(entry as { isGtdProject?: unknown }).isGtdProject === true ||
			(entry as { is_gtd_project?: unknown }).is_gtd_project === true;
		const labelRaw =
			typeof (entry as { canonicalLabel?: unknown }).canonicalLabel === 'string'
				? (entry as { canonicalLabel: string }).canonicalLabel.trim()
				: typeof (entry as { canonical_label?: unknown }).canonical_label === 'string'
					? (entry as { canonical_label: string }).canonical_label.trim()
					: '';
		out.push({
			entityId: idRaw,
			isGtdProject,
			canonicalLabel: labelRaw
		});
	}
	return out;
}

function buildBatchAuditPrompt(
	entries: Array<{ context: HubJudgmentContext }>
): string {
	const blocks = entries.map(({ context }) => {
		const linked = context.linkedThoughtSummaries.map((s) => `    - ${s}`).join('\n') || '    (none)';
		const tasks = context.openTaskSummaries.map((s) => `  - ${s}`).join('\n') || '  (none)';
		return [
			`- entityId: ${context.entityId}`,
			`  label: ${context.label}`,
			`  entityType: ${context.entityType}`,
			`  linkedThoughtCount: ${context.linkedThoughtCount}`,
			`  openTaskCount: ${context.openTaskCount}`,
			'  linkedThoughts:',
			linked,
			'  openTasks:',
			tasks
		].join('\n');
	});

	return [
		'Return ONLY JSON:',
		'{ "results": [ { "entityId": "uuid", "isGtdProject": true|false, "canonicalLabel": "name" } ] }',
		'',
		'Audit each hub below. Keep isGtdProject true only for multi-step initiatives.',
		'Demote ingredients, people, book titles, parts, domains, and single one-off chores.',
		'Copy entityId exactly from the catalog.',
		'',
		'Hubs:',
		blocks.join('\n\n')
	].join('\n');
}

export async function demoteProjectProfile(userId: string, entityId: string): Promise<void> {
	const id = validateNonEmptyEntityId(entityId, 'entityId');
	await getDb()
		.delete(projectProfile)
		.where(and(eq(projectProfile.userId, userId), eq(projectProfile.projectEntityId, id)));

	const [entity] = await getDb()
		.select({ entityType: canonicalEntity.entityType })
		.from(canonicalEntity)
		.where(and(eq(canonicalEntity.userId, userId), eq(canonicalEntity.id, id)))
		.limit(1);
	if (entity?.entityType === 'project') {
		await getDb()
			.update(canonicalEntity)
			.set({ entityType: 'organization' })
			.where(and(eq(canonicalEntity.userId, userId), eq(canonicalEntity.id, id)));
	}
}

export async function auditGtdProjectProfiles(userId: string): Promise<{ demoted: number }> {
	const profileRows = await getDb()
		.select({
			entityId: projectProfile.projectEntityId,
			source: projectProfile.source
		})
		.from(projectProfile)
		.where(eq(projectProfile.userId, userId));

	// Only audit capture-sourced projects — manual projects are user-declared and must never be altered
	const auditableRows = profileRows.filter((row) => (row.source ?? 'capture') === 'capture');
	if (auditableRows.length === 0) return { demoted: 0 };

	const entries: Array<{ context: HubJudgmentContext }> = [];
	for (const row of auditableRows) {
		const context = await loadHubJudgmentContext(userId, row.entityId);
		if (context) entries.push({ context });
	}
	if (entries.length === 0) return { demoted: 0 };

	const allowedEntityIds = new Set(entries.map((e) => e.context.entityId));
	const response = await llmChatCompletion({
		userId,
		messages: [
			{
				role: 'system',
				content:
					'You audit GTD project lists and remove false positives. Return only valid JSON.'
			},
			{ role: 'user', content: buildBatchAuditPrompt(entries) }
		],
		temperature: 0
	});

	const parsed = JSON.parse(stripMarkdownJsonFences(extractChatContent(response))) as unknown;
	const results = parseGtdProjectAuditBatchPayload(parsed, allowedEntityIds);

	let demoted = 0;
	for (const result of results) {
		if (result.isGtdProject) continue;
		demoteProjectProfile(userId, result.entityId);
		demoted += 1;
	}

	// SAFEGUARD: Never allow demoting ALL capture projects in a single audit
	// If the LLM tries to demote everything, treat it as an LLM error and roll back
	if (demoted > 0 && demoted === auditableRows.length) {
		console.error('[audit-gtd] LLM attempted to demote ALL capture projects — rolling back', {
			userId,
			demoted,
			auditableCount: auditableRows.length
		});
		// Re-insert all demoted profiles
		for (const row of auditableRows) {
			await getDb()
				.insert(projectProfile)
				.values({
					userId,
					projectEntityId: row.entityId,
					status: 'active',
					source: 'capture'
				})
				.onConflictDoNothing();
			// Restore entity type to 'project' if it was changed
			await getDb()
				.update(canonicalEntity)
				.set({ entityType: 'project' })
				.where(
					and(
						eq(canonicalEntity.userId, userId),
						eq(canonicalEntity.id, row.entityId),
						eq(canonicalEntity.entityType, 'organization')
					)
				);
		}
		return { demoted: 0 };
	}

	return { demoted };
}
