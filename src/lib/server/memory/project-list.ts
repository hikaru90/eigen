import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
	canonicalEntity,
	projectProfile,
	thought,
	thoughtEntity,
	type ProjectStatus
} from '$lib/server/db/schema';
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption';
import { openLoopItemId } from '$lib/server/memory/temporal-event-list';
import { validateNonEmptyEntityId } from '$lib/server/validation/mcp-args';

export type ProjectNextAction = {
	thoughtId: string;
	summary: string;
	itemId: string;
};

export type ProjectListItem = {
	entityId: string;
	label: string;
	status: ProjectStatus;
	nextAction: ProjectNextAction | null;
	openLoopCount: number;
};

function thoughtStatusFromMetadata(metadata: Record<string, unknown>): 'open' | 'completed' {
	return metadata.status === 'completed' ? 'completed' : 'open';
}

async function summarizeThought(userId: string, thoughtId: string): Promise<string | null> {
	const [row] = await getDb()
		.select({
			normalizedText: thought.normalizedText,
			normalizedTextEncrypted: thought.normalizedTextEncrypted
		})
		.from(thought)
		.where(and(eq(thought.userId, userId), eq(thought.id, thoughtId)))
		.limit(1);
	if (!row) return null;

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

async function countOpenLoopsForProject(userId: string, projectEntityId: string): Promise<number> {
	const rows = await getDb()
		.select({
			thoughtId: thoughtEntity.thoughtId,
			memoryType: thought.memoryType,
			metadata: thought.metadata,
			metadataEncrypted: thought.metadataEncrypted
		})
		.from(thoughtEntity)
		.innerJoin(thought, eq(thoughtEntity.thoughtId, thought.id))
		.where(
			and(
				eq(thoughtEntity.userId, userId),
				eq(thoughtEntity.entityId, projectEntityId),
				sql`(${thought.memoryType} = 'open_loop' OR ${thought.category} = 'task')`
			)
		);

	let count = 0;
	for (const row of rows) {
		const metadataJson = row.metadataEncrypted
			? await decryptTenantValue({
					userId,
					table: 'thought',
					column: 'metadata',
					ciphertext: row.metadataEncrypted
				})
			: JSON.stringify(row.metadata ?? {});
		const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
		if (thoughtStatusFromMetadata(metadata) === 'open') count += 1;
	}
	return count;
}

function projectSortRank(item: ProjectListItem): number {
	if (item.status === 'active' && item.nextAction == null) return 0;
	if (item.status === 'active') return 1;
	if (item.status === 'someday') return 2;
	return 3;
}

export async function listProjectsForUser(userId: string): Promise<ProjectListItem[]> {
	const projectRows = await getDb()
		.select({
			entityId: canonicalEntity.id,
			label: canonicalEntity.label,
			status: projectProfile.status,
			nextActionThoughtId: projectProfile.nextActionThoughtId
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

	const items: ProjectListItem[] = [];
	for (const row of projectRows) {
		const status = (row.status ?? 'active') as ProjectStatus;
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
		const openLoopCount = await countOpenLoopsForProject(userId, row.entityId);
		items.push({
			entityId: row.entityId,
			label: row.label,
			status,
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

export async function ensureProjectProfile(
	userId: string,
	projectEntityId: string,
	status: ProjectStatus = 'active'
): Promise<void> {
	const entityId = validateNonEmptyEntityId(projectEntityId, 'projectEntityId');
	await getDb()
		.insert(projectProfile)
		.values({
			userId,
			projectEntityId: entityId,
			status
		})
		.onConflictDoNothing();
}
