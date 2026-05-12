import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { AppDatabase } from '$lib/server/db/context';
import { ontologyEntityKind, ontologyRelationKind, thought } from '$lib/server/db/schema';
import { DEFAULT_COGNITIVE_ENTITY_KIND_KEYS } from './seed-default-cognitive';

const protectedEntityKeys = new Set(DEFAULT_COGNITIVE_ENTITY_KIND_KEYS);

/**
 * Deletes custom `ontology_entity_kind` rows that are not referenced by any thought and are not part
 * of the baseline cognitive seed (see {@link DEFAULT_COGNITIVE_ENTITY_KIND_KEYS}). First removes
 * `ontology_relation_kind` rows that reference a deleted entity as an endpoint (FK `restrict`).
 */
export async function pruneUnusedOntologyEntityKinds(
	db: AppDatabase,
	userId: string
): Promise<{ deletedEntityKindIds: string[]; deletedRelationKindIds: string[] }> {
	const entities = await db
		.select({ id: ontologyEntityKind.id, key: ontologyEntityKind.key })
		.from(ontologyEntityKind)
		.where(eq(ontologyEntityKind.userId, userId));

	const thoughtRefs = await db
		.select({ kindId: thought.ontologyEntityKindId })
		.from(thought)
		.where(and(eq(thought.userId, userId), isNotNull(thought.ontologyEntityKindId)));

	const usedIds = new Set(
		thoughtRefs
			.map((r) => r.kindId)
			.filter((id): id is string => typeof id === 'string' && id.length > 0)
	);

	const categoryRows = await db
		.selectDistinct({ key: thought.category })
		.from(thought)
		.where(eq(thought.userId, userId));
	const usedCategoryKeys = new Set(categoryRows.map((r) => r.key.trim()).filter((k) => k.length > 0));

	const entityIdsToDelete = entities
		.filter(
			(e) =>
				!protectedEntityKeys.has(e.key) &&
				!usedIds.has(e.id) &&
				!usedCategoryKeys.has(e.key)
		)
		.map((e) => e.id);

	if (entityIdsToDelete.length === 0) {
		return { deletedEntityKindIds: [], deletedRelationKindIds: [] };
	}

	const idSet = new Set(entityIdsToDelete);
	const relations = await db
		.select({
			id: ontologyRelationKind.id,
			fromOntologyEntityKindId: ontologyRelationKind.fromOntologyEntityKindId,
			toOntologyEntityKindId: ontologyRelationKind.toOntologyEntityKindId
		})
		.from(ontologyRelationKind)
		.where(eq(ontologyRelationKind.userId, userId));

	const relationIdsToDelete = relations
		.filter((r) => idSet.has(r.fromOntologyEntityKindId) || idSet.has(r.toOntologyEntityKindId))
		.map((r) => r.id);

	await db.transaction(async (tx) => {
		if (relationIdsToDelete.length > 0) {
			await tx
				.delete(ontologyRelationKind)
				.where(
					and(
						eq(ontologyRelationKind.userId, userId),
						inArray(ontologyRelationKind.id, relationIdsToDelete)
					)
				);
		}
		await tx
			.delete(ontologyEntityKind)
			.where(
				and(eq(ontologyEntityKind.userId, userId), inArray(ontologyEntityKind.id, entityIdsToDelete))
			);
	});

	return {
		deletedEntityKindIds: entityIdsToDelete,
		deletedRelationKindIds: relationIdsToDelete
	};
}
