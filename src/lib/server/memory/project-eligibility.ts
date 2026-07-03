import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
	projectProfile,
	thought,
	thoughtEntity,
	type ProjectProfileSource,
	type ProjectStatus
} from '$lib/server/db/schema';
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption';
import { validateNonEmptyEntityId } from '$lib/server/validation/mcp-args';

export function thoughtStatusFromMetadata(metadata: Record<string, unknown>): 'open' | 'completed' {
	return metadata.status === 'completed' ? 'completed' : 'open';
}

export async function countLinkedThoughtsForProjectEntity(
	userId: string,
	entityId: string
): Promise<number> {
	const [row] = await getDb()
		.select({ count: sql<number>`count(distinct ${thoughtEntity.thoughtId})::int` })
		.from(thoughtEntity)
		.where(and(eq(thoughtEntity.userId, userId), eq(thoughtEntity.entityId, entityId)));
	return row?.count ?? 0;
}

export async function countOpenTasksForProjectEntity(
	userId: string,
	projectEntityId: string
): Promise<number> {
	const rows = await getDb()
		.select({
			thoughtId: thoughtEntity.thoughtId,
			metadata: thought.metadata,
			metadataEncrypted: thought.metadataEncrypted
		})
		.from(thoughtEntity)
		.innerJoin(thought, eq(thoughtEntity.thoughtId, thought.id))
		.where(
			and(
				eq(thoughtEntity.userId, userId),
				eq(thoughtEntity.entityId, projectEntityId),
				eq(thought.category, 'task')
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

export async function countGtdProjectProfilesForUser(userId: string): Promise<number> {
	const [row] = await getDb()
		.select({ count: sql<number>`count(*)::int` })
		.from(projectProfile)
		.where(eq(projectProfile.userId, userId));
	return row?.count ?? 0;
}

export async function ensureProjectProfile(
	userId: string,
	projectEntityId: string,
	status: ProjectStatus = 'active',
	source: ProjectProfileSource = 'capture'
): Promise<void> {
	const entityId = validateNonEmptyEntityId(projectEntityId, 'projectEntityId');
	await getDb()
		.insert(projectProfile)
		.values({
			userId,
			projectEntityId: entityId,
			status,
			source
		})
		.onConflictDoUpdate({
			target: [projectProfile.userId, projectProfile.projectEntityId],
			set: {
				status,
				source
			}
		});
}
