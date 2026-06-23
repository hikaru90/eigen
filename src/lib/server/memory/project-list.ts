import { and, eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
	canonicalEntity,
	projectProfile,
	type ProjectProfileSource,
	type ProjectStatus
} from '$lib/server/db/schema';
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption';
import { thought } from '$lib/server/db/schema';
import { auditGtdProjectProfiles } from '$lib/server/memory/judge-gtd-project';
import { openLoopItemId } from '$lib/server/memory/temporal-event-list';
import {
	countOpenLoopsForProjectEntity,
	ensureProjectProfile,
	thoughtStatusFromMetadata
} from '$lib/server/memory/project-eligibility';

export type ProjectNextAction = {
	thoughtId: string;
	summary: string;
	itemId: string;
};

export type ProjectListItem = {
	entityId: string;
	label: string;
	status: ProjectStatus;
	source: ProjectProfileSource;
	nextAction: ProjectNextAction | null;
	openLoopCount: number;
};

async function summarizeThought(userId: string, thoughtId: string): Promise<string | null> {
	const [row] = await getDb()
		.select({
			normalizedText: thought.normalizedText,
			normalizedTextEncrypted: thought.normalizedTextEncrypted,
			metadata: thought.metadata,
			metadataEncrypted: thought.metadataEncrypted
		})
		.from(thought)
		.where(and(eq(thought.userId, userId), eq(thought.id, thoughtId)))
		.limit(1);
	if (!row) return null;

	const metadataJson = row.metadataEncrypted
		? await decryptTenantValue({
				userId,
				table: 'thought',
				column: 'metadata',
				ciphertext: row.metadataEncrypted
			})
		: JSON.stringify(row.metadata ?? {});
	const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
	if (thoughtStatusFromMetadata(metadata) === 'completed') return null;

	const text = row.normalizedTextEncrypted
		? await decryptTenantValue({
				userId,
				table: 'thought',
				column: 'normalized_text',
				ciphertext: row.normalizedTextEncrypted
			})
		: row.normalizedText;
	const trimmed = text.trim();
	if (!trimmed) return null;
	return trimmed.length > 120 ? `${trimmed.slice(0, 117).trim()}…` : trimmed;
}

function projectSortRank(item: ProjectListItem): number {
	if (item.status === 'active' && item.nextAction == null) return 0;
	if (item.status === 'active') return 1;
	if (item.status === 'someday') return 2;
	return 3;
}

export async function listProjectsForUser(userId: string): Promise<ProjectListItem[]> {
	await auditGtdProjectProfiles(userId);

	const projectRows = await getDb()
		.select({
			entityId: canonicalEntity.id,
			label: canonicalEntity.label,
			status: projectProfile.status,
			source: projectProfile.source,
			nextActionThoughtId: projectProfile.nextActionThoughtId
		})
		.from(projectProfile)
		.innerJoin(
			canonicalEntity,
			and(
				eq(canonicalEntity.id, projectProfile.projectEntityId),
				eq(canonicalEntity.userId, userId)
			)
		)
		.where(eq(projectProfile.userId, userId));

	const items: ProjectListItem[] = [];
	for (const row of projectRows) {
		const status = row.status as ProjectStatus;
		const source = (row.source ?? 'capture') as ProjectProfileSource;
		let nextAction: ProjectNextAction | null = null;
		if (row.nextActionThoughtId) {
			const summary = await summarizeThought(userId, row.nextActionThoughtId);
			if (summary) {
				nextAction = {
					thoughtId: row.nextActionThoughtId,
					summary,
					itemId: openLoopItemId(row.nextActionThoughtId)
				};
			}
		}
		const openLoopCount = await countOpenLoopsForProjectEntity(userId, row.entityId);
		items.push({
			entityId: row.entityId,
			label: row.label,
			status,
			source,
			nextAction,
			openLoopCount
		});
	}

	return items.sort((a, b) => {
		const rankDiff = projectSortRank(a) - projectSortRank(b);
		if (rankDiff !== 0) return rankDiff;
		return a.label.localeCompare(b.label);
	});
}

export {
	countLinkedThoughtsForProjectEntity,
	countOpenLoopsForProjectEntity,
	ensureProjectProfile
} from '$lib/server/memory/project-eligibility';

export type EligibleGtdProject = {
	entityId: string;
	label: string;
	status: ProjectStatus;
	source: ProjectProfileSource;
	openLoopCount: number;
};

/** Active GTD projects in the assignment catalog (LLM-audited profiles only). */
export async function loadEligibleGtdProjects(userId: string): Promise<EligibleGtdProject[]> {
	const rows = await getDb()
		.select({
			entityId: canonicalEntity.id,
			label: canonicalEntity.label,
			status: projectProfile.status,
			source: projectProfile.source
		})
		.from(projectProfile)
		.innerJoin(
			canonicalEntity,
			and(
				eq(canonicalEntity.id, projectProfile.projectEntityId),
				eq(canonicalEntity.userId, userId)
			)
		)
		.where(and(eq(projectProfile.userId, userId), eq(projectProfile.status, 'active')));

	const out: EligibleGtdProject[] = [];
	for (const row of rows) {
		const source = (row.source ?? 'capture') as ProjectProfileSource;
		const openLoopCount = await countOpenLoopsForProjectEntity(userId, row.entityId);
		out.push({
			entityId: row.entityId,
			label: row.label,
			status: row.status as ProjectStatus,
			source,
			openLoopCount
		});
	}
	return out;
}

/** @deprecated Use loadEligibleGtdProjects for assignment catalog. */
export async function loadGtdProjectOptionsFromProfiles(userId: string) {
	return loadEligibleGtdProjects(userId);
}
