import { and, eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { canonicalEntity, projectProfile, thoughtEntity } from '$lib/server/db/schema';
import { upsertMentionEdge } from '$lib/server/graph/age';
import { ensureProjectProfile } from '$lib/server/memory/project-list';
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
				eq(canonicalEntity.entityType, 'project')
			)
		)
		.limit(1);
	if (!entity) {
		throw new Error(`designateNextAction: project entity ${entityId} not found for user`);
	}

	await ensureProjectProfile(userId, entityId, 'active');

	await getDb()
		.insert(thoughtEntity)
		.values({
			userId,
			thoughtId: tid,
			entityId,
			salience: 1
		})
		.onConflictDoNothing();

	await upsertMentionEdge({ userId, thoughtId: tid, entityId });

	const now = new Date();
	await getDb()
		.insert(projectProfile)
		.values({
			userId,
			projectEntityId: entityId,
			status: 'active',
			nextActionThoughtId: tid,
			designatedAt: now
		})
		.onConflictDoUpdate({
			target: [projectProfile.userId, projectProfile.projectEntityId],
			set: {
				nextActionThoughtId: tid,
				designatedAt: now,
				status: 'active'
			}
		});
}

export async function clearNextActionIfCompleted(userId: string, thoughtId: string): Promise<void> {
	const tid = validateNonEmptyEntityId(thoughtId, 'thoughtId');
	await getDb()
		.update(projectProfile)
		.set({ nextActionThoughtId: null, designatedAt: null })
		.where(and(eq(projectProfile.userId, userId), eq(projectProfile.nextActionThoughtId, tid)));
}

export async function linkThoughtToProject(
	userId: string,
	projectEntityId: string,
	thoughtId: string
): Promise<void> {
	const entityId = validateNonEmptyEntityId(projectEntityId, 'projectEntityId');
	const tid = validateNonEmptyEntityId(thoughtId, 'thoughtId');

	await getDb()
		.insert(thoughtEntity)
		.values({
			userId,
			thoughtId: tid,
			entityId,
			salience: 1
		})
		.onConflictDoNothing();

	await upsertMentionEdge({ userId, thoughtId: tid, entityId });
	await ensureProjectProfile(userId, entityId);
}
