import { and, eq, or } from 'drizzle-orm';
import type { AppDatabase } from '$lib/server/db/context';
import { ontologyEntityKind, ontologyRelationKind, thought, thoughtRelation } from '$lib/server/db/schema';

/**
 * After deactivating a relation kind: clear FK on thought edges that pointed at it (no dangling refs).
 */
export async function reconcileThoughtRelationsAfterRelationKindDeactivate(
	db: AppDatabase,
	userId: string,
	relationKindId: string
): Promise<void> {
	await db
		.update(thoughtRelation)
		.set({ ontologyRelationKindId: null })
		.where(
			and(
				eq(thoughtRelation.userId, userId),
				eq(thoughtRelation.ontologyRelationKindId, relationKindId)
			)
		);
}

/**
 * After deactivating an entity kind: clear optional thought.ontology_entity_kind_id pointers.
 */
export async function reconcileThoughtsAfterEntityKindDeactivate(
	db: AppDatabase,
	userId: string,
	entityKindId: string
): Promise<void> {
	await db
		.update(thought)
		.set({ ontologyEntityKindId: null })
		.where(and(eq(thought.userId, userId), eq(thought.ontologyEntityKindId, entityKindId)));
}

/**
 * Deactivate relation kinds that reference an entity kind as endpoint; then caller may deactivate the entity kind.
 * Does not delete rows (preserves read-path JOIN by id for history).
 */
export async function deactivateRelationKindsTouchingEntityKind(
	db: AppDatabase,
	userId: string,
	entityKindId: string
): Promise<string[]> {
	const touched = await db
		.select({ id: ontologyRelationKind.id })
		.from(ontologyRelationKind)
		.where(
			and(
				eq(ontologyRelationKind.userId, userId),
				or(
					eq(ontologyRelationKind.fromOntologyEntityKindId, entityKindId),
					eq(ontologyRelationKind.toOntologyEntityKindId, entityKindId)
				)
			)
		);

	const ids = touched.map((t) => t.id);
	for (const id of ids) {
		await reconcileThoughtRelationsAfterRelationKindDeactivate(db, userId, id);
		await db
			.update(ontologyRelationKind)
			.set({ active: false })
			.where(and(eq(ontologyRelationKind.userId, userId), eq(ontologyRelationKind.id, id)));
	}
	return ids;
}

export async function deactivateRelationKindWithReconcile(
	db: AppDatabase,
	userId: string,
	relationKindId: string
): Promise<void> {
	await reconcileThoughtRelationsAfterRelationKindDeactivate(db, userId, relationKindId);
	await db
		.update(ontologyRelationKind)
		.set({ active: false })
		.where(and(eq(ontologyRelationKind.userId, userId), eq(ontologyRelationKind.id, relationKindId)));
}

/**
 * Deactivate an entity kind and dependent relation kinds; clears optional thought / thought_relation FKs.
 * Definition rows remain for history JOINs; `active` gates **new** ingest only.
 */
export async function deactivateEntityKindWithReconcile(
	db: AppDatabase,
	userId: string,
	entityKindId: string
): Promise<void> {
	await deactivateRelationKindsTouchingEntityKind(db, userId, entityKindId);
	await reconcileThoughtsAfterEntityKindDeactivate(db, userId, entityKindId);
	await db
		.update(ontologyEntityKind)
		.set({ active: false })
		.where(and(eq(ontologyEntityKind.userId, userId), eq(ontologyEntityKind.id, entityKindId)));
}
