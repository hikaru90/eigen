import { and, eq, or } from 'drizzle-orm'
import type { AppDatabase } from '$lib/server/db/context'
import {
  ontologyEntityKind,
  ontologyRelationKind,
  thought,
  thoughtRelation,
} from '$lib/server/db/schema'
import { DEFAULT_ENTITY_TYPE_KIND_KEYS } from './seed-default-cognitive'

/**
 * Entity type kind keys that must never be deactivated.
 * These are critical for core system functionality (e.g., GTD projects).
 */
const CRITICAL_ENTITY_TYPE_KEYS = new Set(['project'])

/**
 * Checks if an entity kind key is critical and should never be deactivated.
 */
export function isCriticalEntityTypeKind(key: string): boolean {
  return CRITICAL_ENTITY_TYPE_KEYS.has(key)
}

/**
 * After deactivating a relation kind: clear FK on thought edges that pointed at it (no dangling refs).
 */
export async function reconcileThoughtRelationsAfterRelationKindDeactivate(
  db: AppDatabase,
  userId: string,
  relationKindId: string,
): Promise<void> {
  await db
    .update(thoughtRelation)
    .set({ ontologyRelationKindId: null })
    .where(
      and(
        eq(thoughtRelation.userId, userId),
        eq(thoughtRelation.ontologyRelationKindId, relationKindId),
      ),
    )
}

/**
 * After deactivating an entity kind: clear optional thought.ontology_entity_kind_id pointers.
 */
export async function reconcileThoughtsAfterEntityKindDeactivate(
  db: AppDatabase,
  userId: string,
  entityKindId: string,
): Promise<void> {
  await db
    .update(thought)
    .set({ ontologyEntityKindId: null })
    .where(and(eq(thought.userId, userId), eq(thought.ontologyEntityKindId, entityKindId)))
}

/**
 * Deactivate relation kinds that reference an entity kind as endpoint; then caller may deactivate the entity kind.
 * Does not delete rows (preserves read-path JOIN by id for history).
 */
export async function deactivateRelationKindsTouchingEntityKind(
  db: AppDatabase,
  userId: string,
  entityKindId: string,
): Promise<string[]> {
  const touched = await db
    .select({ id: ontologyRelationKind.id })
    .from(ontologyRelationKind)
    .where(
      and(
        eq(ontologyRelationKind.userId, userId),
        or(
          eq(ontologyRelationKind.fromOntologyEntityKindId, entityKindId),
          eq(ontologyRelationKind.toOntologyEntityKindId, entityKindId),
        ),
      ),
    )

  const ids = touched.map((t) => t.id)
  for (const id of ids) {
    await reconcileThoughtRelationsAfterRelationKindDeactivate(db, userId, id)
    await db
      .update(ontologyRelationKind)
      .set({ active: false })
      .where(and(eq(ontologyRelationKind.userId, userId), eq(ontologyRelationKind.id, id)))
  }
  return ids
}

export async function deactivateRelationKindWithReconcile(
  db: AppDatabase,
  userId: string,
  relationKindId: string,
): Promise<void> {
  await reconcileThoughtRelationsAfterRelationKindDeactivate(db, userId, relationKindId)
  await db
    .update(ontologyRelationKind)
    .set({ active: false })
    .where(
      and(eq(ontologyRelationKind.userId, userId), eq(ontologyRelationKind.id, relationKindId)),
    )
}

/**
 * Deactivate an entity kind and dependent relation kinds; clears optional thought / thought_relation FKs.
 * Definition rows remain for history JOINs; `active` gates **new** ingest only.
 *
 * @throws Error if the entity kind is critical (e.g., 'project') and cannot be deactivated.
 */
export async function deactivateEntityKindWithReconcile(
  db: AppDatabase,
  userId: string,
  entityKindId: string,
): Promise<void> {
  // Look up the entity kind key to check if it's critical
  const [entityKind] = await db
    .select({ key: ontologyEntityKind.key })
    .from(ontologyEntityKind)
    .where(and(eq(ontologyEntityKind.userId, userId), eq(ontologyEntityKind.id, entityKindId)))
    .limit(1)

  if (entityKind && isCriticalEntityTypeKind(entityKind.key)) {
    throw new Error(
      `Cannot deactivate critical entity type '${entityKind.key}': it is required for core system functionality`,
    )
  }

  await deactivateRelationKindsTouchingEntityKind(db, userId, entityKindId)
  await reconcileThoughtsAfterEntityKindDeactivate(db, userId, entityKindId)
  await db
    .update(ontologyEntityKind)
    .set({ active: false })
    .where(and(eq(ontologyEntityKind.userId, userId), eq(ontologyEntityKind.id, entityKindId)))
}
