import { and, desc, eq, inArray, notInArray } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { canonicalEntity, entityResolutionLog, thought } from '$lib/server/db/schema';
import { deleteEntityVertexFromGraph, upsertEntityNode } from '$lib/server/graph/falkor';
import {
	activeEntityTypeKindKeys,
	DEFAULT_ENTITY_TYPE_KIND_KEYS,
	ensureEntityTypeKindsSeeded,
	ensureUserOntologySeeded,
	loadOntologyForUser
} from '$lib/server/ontology-db';
import { validateNonEmptyEntityId } from '$lib/server/validation/mcp-args';

/** Postgres provenance: captures that resolved a mention to this canonical entity. */
export async function listThoughtsMentioningCanonicalEntity(
	userId: string,
	entityId: string,
	limit = 40
) {
	const id = validateNonEmptyEntityId(entityId, 'entityId');
	const capped = Math.min(Math.max(limit, 1), 100);

	const links = await getDb()
		.selectDistinct({ thoughtId: entityResolutionLog.thoughtId })
		.from(entityResolutionLog)
		.where(
			and(eq(entityResolutionLog.userId, userId), eq(entityResolutionLog.canonicalEntityId, id))
		);

	const thoughtIds = links.map((l) => l.thoughtId).filter((tid) => tid.length > 0);
	if (thoughtIds.length === 0) return [];

	return getDb()
		.select({
			id: thought.id,
			rawText: thought.rawText,
			normalizedText: thought.normalizedText,
			category: thought.category,
			metadata: thought.metadata,
			createdAt: thought.createdAt,
			updatedAt: thought.updatedAt
		})
		.from(thought)
		.where(and(eq(thought.userId, userId), inArray(thought.id, thoughtIds)))
		.orderBy(desc(thought.createdAt))
		.limit(capped);
}

export async function getCanonicalEntityForUser(userId: string, entityId: string) {
	const id = validateNonEmptyEntityId(entityId, 'entityId');
	const [row] = await getDb()
		.select({
			id: canonicalEntity.id,
			label: canonicalEntity.label,
			entityType: canonicalEntity.entityType,
			canonicalKey: canonicalEntity.canonicalKey
		})
		.from(canonicalEntity)
		.where(and(eq(canonicalEntity.id, id), eq(canonicalEntity.userId, userId)))
		.limit(1);
	return row ?? null;
}

export async function updateCanonicalEntityForUser(
	userId: string,
	entityId: string,
	patch: { label?: string; entityType?: string }
): Promise<{ ok: true; entity: Awaited<ReturnType<typeof getCanonicalEntityForUser>> } | { ok: false; reason: 'not_found' }> {
	const existing = await getCanonicalEntityForUser(userId, entityId);
	if (!existing) return { ok: false, reason: 'not_found' };

	const nextLabel = patch.label !== undefined ? patch.label.trim() : existing.label;
	if (!nextLabel) {
		throw new Error('label must be non-empty');
	}
	let nextType = existing.entityType;
	if (patch.entityType !== undefined) {
		const trimmed = patch.entityType.trim();
		if (!trimmed) {
			throw new Error('entityType cannot be empty when provided');
		}
		await ensureUserOntologySeeded(getDb(), userId);
		const loaded = await loadOntologyForUser(getDb(), userId);
		const activeTypes = activeEntityTypeKindKeys(loaded);
		if (!activeTypes.has(trimmed)) {
			throw new Error(`entityType must be an active entity type kind key, got: ${trimmed}`);
		}
		nextType = trimmed;
	}

	await getDb()
		.update(canonicalEntity)
		.set({ label: nextLabel, entityType: nextType })
		.where(and(eq(canonicalEntity.id, existing.id), eq(canonicalEntity.userId, userId)));

	const updated = await getCanonicalEntityForUser(userId, existing.id);
	if (!updated) return { ok: false, reason: 'not_found' };

	await upsertEntityNode({
		id: updated.id,
		userId,
		canonicalKey: updated.canonicalKey,
		label: updated.label,
		entityType: updated.entityType
	});

	return { ok: true, entity: updated };
}

/**
 * Rewrites `canonical_entity.entity_type` (and Falkor `entity_type`) when the stored value is not
 * one of the user's **active entity_type** ontology kind keys — e.g. legacy rows typed with old cognitive keys.
 * Picks the first still-active entity type kind as fallback (defaults to 'concept').
 */
export async function repairCanonicalEntityTypesForUser(userId: string): Promise<{ repaired: number }> {
	await ensureUserOntologySeeded(getDb(), userId);
	// Upgrade path: insert entity type kinds if the user only has the old cognitive ontology
	await ensureEntityTypeKindsSeeded(getDb(), userId);
	const loaded = await loadOntologyForUser(getDb(), userId);
	const activeTypes = activeEntityTypeKindKeys(loaded);
	if (activeTypes.size === 0) {
		throw new Error('Cannot repair entity types: no active entity type kinds');
	}
	// Prefer 'concept' as fallback, then first from default list, then any active key
	let fallback: string | undefined;
	for (const k of DEFAULT_ENTITY_TYPE_KIND_KEYS) {
		if (activeTypes.has(k)) {
			fallback = k;
			if (k === 'concept') break; // concept is the safest semantic fallback
		}
	}
	if (!fallback) {
		fallback = [...activeTypes].sort((a, b) => a.localeCompare(b))[0];
	}
	if (!fallback) {
		throw new Error('Cannot repair entity types: empty active entity type kind set');
	}

	const activeTypeList = [...activeTypes];
	const stale = await getDb()
		.select({
			id: canonicalEntity.id,
			canonicalKey: canonicalEntity.canonicalKey,
			label: canonicalEntity.label,
			entityType: canonicalEntity.entityType
		})
		.from(canonicalEntity)
		.where(and(eq(canonicalEntity.userId, userId), notInArray(canonicalEntity.entityType, activeTypeList)));

	if (stale.length === 0) return { repaired: 0 };

	for (const row of stale) {
		await getDb()
			.update(canonicalEntity)
			.set({ entityType: fallback })
			.where(and(eq(canonicalEntity.id, row.id), eq(canonicalEntity.userId, userId)));
		await upsertEntityNode({
			id: row.id,
			userId,
			canonicalKey: row.canonicalKey,
			label: row.label,
			entityType: fallback
		});
	}

	return { repaired: stale.length };
}

export async function syncCanonicalEntityVertexToGraph(
	userId: string,
	entityId: string
): Promise<{ ok: true } | { ok: false; reason: 'not_found' }> {
	const row = await getCanonicalEntityForUser(userId, entityId);
	if (!row) return { ok: false, reason: 'not_found' };
	await upsertEntityNode({
		id: row.id,
		userId,
		canonicalKey: row.canonicalKey,
		label: row.label,
		entityType: row.entityType
	});
	return { ok: true };
}

export async function deleteCanonicalEntityForUser(
	userId: string,
	entityId: string
): Promise<{ ok: true } | { ok: false; reason: 'not_found' }> {
	const row = await getCanonicalEntityForUser(userId, entityId);
	if (!row) return { ok: false, reason: 'not_found' };

	await deleteEntityVertexFromGraph({ userId, entityId: row.id });
	await getDb()
		.delete(canonicalEntity)
		.where(and(eq(canonicalEntity.id, row.id), eq(canonicalEntity.userId, userId)));

	return { ok: true };
}
