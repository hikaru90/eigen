import { and, eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { canonicalEntity } from '$lib/server/db/schema';
import { upsertEntityNode } from '$lib/server/graph/age';
import { computeLexicalText } from '$lib/server/memory/lexical-text';

export async function upsertProjectEntity(userId: string, name: string): Promise<string> {
	const label = name.trim();
	if (!label) {
		throw new Error('upsertProjectEntity: project name is required');
	}
	const canonicalKey = computeLexicalText(label);
	const [existing] = await getDb()
		.select({ id: canonicalEntity.id })
		.from(canonicalEntity)
		.where(and(eq(canonicalEntity.userId, userId), eq(canonicalEntity.canonicalKey, canonicalKey)))
		.limit(1);

	if (existing) {
		await getDb()
			.update(canonicalEntity)
			.set({ entityType: 'project', label })
			.where(and(eq(canonicalEntity.userId, userId), eq(canonicalEntity.id, existing.id)));
		await upsertEntityNode({
			id: existing.id,
			userId,
			canonicalKey,
			label,
			entityType: 'project'
		});
		return existing.id;
	}

	const [created] = await getDb()
		.insert(canonicalEntity)
		.values({
			userId,
			canonicalKey,
			label,
			entityType: 'project'
		})
		.returning({ id: canonicalEntity.id });

	if (!created) {
		throw new Error('upsertProjectEntity: insert returned no row');
	}

	await upsertEntityNode({
		id: created.id,
		userId,
		canonicalKey,
		label,
		entityType: 'project'
	});

	return created.id;
}
