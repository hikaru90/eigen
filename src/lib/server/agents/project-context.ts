import { and, eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { thoughtEntity, projectProfile, canonicalEntity } from '$lib/server/db/schema';

export type ProjectContext = {
	projectEntityIds: string[];
	projectLabels: string[];
};

export async function loadProjectContextForThought(
	userId: string,
	thoughtId: string
): Promise<ProjectContext> {
	const db = getDb();

	const rows = await db
		.select({
			projectEntityId: projectProfile.projectEntityId,
			label: canonicalEntity.label
		})
		.from(thoughtEntity)
		.innerJoin(
			projectProfile,
			and(
				eq(projectProfile.projectEntityId, thoughtEntity.entityId),
				eq(projectProfile.userId, userId)
			)
		)
		.innerJoin(canonicalEntity, eq(canonicalEntity.id, thoughtEntity.entityId))
		.where(and(eq(thoughtEntity.thoughtId, thoughtId), eq(thoughtEntity.userId, userId)));

	return {
		projectEntityIds: rows.map((r) => r.projectEntityId),
		projectLabels: rows.map((r) => r.label)
	};
}

export async function loadProjectContextForThoughts(
	userId: string,
	thoughtIds: string[]
): Promise<Map<string, ProjectContext>> {
	if (thoughtIds.length === 0) return new Map();

	const db = getDb();
	const result = new Map<string, ProjectContext>();

	const rows = await db
		.select({
			thoughtId: thoughtEntity.thoughtId,
			projectEntityId: projectProfile.projectEntityId,
			label: canonicalEntity.label
		})
		.from(thoughtEntity)
		.innerJoin(
			projectProfile,
			and(
				eq(projectProfile.projectEntityId, thoughtEntity.entityId),
				eq(projectProfile.userId, userId)
			)
		)
		.innerJoin(canonicalEntity, eq(canonicalEntity.id, thoughtEntity.entityId))
		.where(
			and(eq(thoughtEntity.userId, userId))
		);

	for (const row of rows) {
		if (!thoughtIds.includes(row.thoughtId)) continue;
		let ctx = result.get(row.thoughtId);
		if (!ctx) {
			ctx = { projectEntityIds: [], projectLabels: [] };
			result.set(row.thoughtId, ctx);
		}
		ctx.projectEntityIds.push(row.projectEntityId);
		ctx.projectLabels.push(row.label);
	}

	return result;
}
