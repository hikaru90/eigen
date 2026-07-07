import { and, eq, isNotNull } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { canonicalEntity, thoughtEntity, type ThoughtEntitySource } from '$lib/server/db/schema';
import { upsertMentionEdge } from '$lib/server/graph/age';
import { validateNonEmptyEntityId } from '$lib/server/validation/mcp-args';

export async function designateNextAction(
	userId: string,
	projectEntityId: string,
	thoughtId: string
): Promise<void> {
	const entityId = validateNonEmptyEntityId(projectEntityId, 'projectEntityId');
	const tid = validateNonEmptyEntityId(thoughtId, 'thoughtId');

	const [entity] = await getDb()
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
	if (!entity) {
		throw new Error(`designateNextAction: GTD project ${entityId} not found for user`);
	}

	await linkThoughtToProject(userId, entityId, tid, 'manual');

	const now = new Date();
	await getDb()
		.update(canonicalEntity)
		.set({
			nextActionThoughtId: tid,
			projectDesignatedAt: now,
			projectStatus: 'active',
			updatedAt: now
		})
		.where(and(eq(canonicalEntity.userId, userId), eq(canonicalEntity.id, entityId)));
}

export async function clearNextActionIfCompleted(userId: string, thoughtId: string): Promise<void> {
	const tid = validateNonEmptyEntityId(thoughtId, 'thoughtId');
	await getDb()
		.update(canonicalEntity)
		.set({ nextActionThoughtId: null, projectDesignatedAt: null, updatedAt: new Date() })
		.where(and(eq(canonicalEntity.userId, userId), eq(canonicalEntity.nextActionThoughtId, tid)));
}

export async function linkThoughtToProject(
	userId: string,
	projectEntityId: string,
	thoughtId: string,
	source: ThoughtEntitySource = 'manual'
): Promise<void> {
	const entityId = validateNonEmptyEntityId(projectEntityId, 'projectEntityId');
	const tid = validateNonEmptyEntityId(thoughtId, 'thoughtId');

	if (source === 'manual') {
		await getDb()
			.insert(thoughtEntity)
			.values({
				userId,
				thoughtId: tid,
				entityId,
				salience: 1,
				source: 'manual'
			})
			.onConflictDoUpdate({
				target: [thoughtEntity.thoughtId, thoughtEntity.entityId],
				set: {
					salience: 1,
					source: 'manual'
				}
			});
	} else {
		await getDb()
			.insert(thoughtEntity)
			.values({
				userId,
				thoughtId: tid,
				entityId,
				salience: 1,
				source: 'ingest'
			})
			.onConflictDoNothing();
	}

	await upsertMentionEdge({ userId, thoughtId: tid, entityId });
}

export async function thoughtHasManualProjectLink(
	userId: string,
	thoughtId: string
): Promise<boolean> {
	const [row] = await getDb()
		.select({ entityId: thoughtEntity.entityId })
		.from(thoughtEntity)
		.innerJoin(canonicalEntity, eq(thoughtEntity.entityId, canonicalEntity.id))
		.where(
			and(
				eq(thoughtEntity.userId, userId),
				eq(thoughtEntity.thoughtId, thoughtId),
				eq(thoughtEntity.source, 'manual'),
				isNotNull(canonicalEntity.projectStatus)
			)
		)
		.limit(1);
	return Boolean(row);
}
