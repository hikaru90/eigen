import { and, eq, notInArray } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { canonicalEntity } from '$lib/server/db/schema';
import { deleteEntityVertexFromGraph, upsertEntityNode } from '$lib/server/graph/falkor';
import {
	activeEntityKindKeys,
	DEFAULT_COGNITIVE_ENTITY_KIND_KEYS,
	ensureUserOntologySeeded,
	loadOntologyForUser
} from '$lib/server/ontology-db';
import { validateNonEmptyEntityId } from '$lib/server/validation/mcp-args';

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
		const active = activeEntityKindKeys(loaded);
		if (!active.has(trimmed)) {
			throw new Error(`entityType must be an active ontology entity kind key, got: ${trimmed}`);
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
 * one of the user's **active** ontology entity kind keys — e.g. legacy `person` / `org` rows.
 * Picks the first still-active baseline cognitive kind when available, otherwise the first active key.
 */
export async function repairCanonicalEntityTypesForUser(userId: string): Promise<{ repaired: number }> {
	await ensureUserOntologySeeded(getDb(), userId);
	const loaded = await loadOntologyForUser(getDb(), userId);
	const active = activeEntityKindKeys(loaded);
	if (active.size === 0) {
		throw new Error('Cannot repair entity types: no active ontology entity kinds');
	}
	let fallback: string | undefined;
	for (const k of DEFAULT_COGNITIVE_ENTITY_KIND_KEYS) {
		if (active.has(k)) {
			fallback = k;
			break;
		}
	}
	if (!fallback) {
		fallback = [...active].sort((a, b) => a.localeCompare(b))[0];
	}
	if (!fallback) {
		throw new Error('Cannot repair entity types: empty active kind set');
	}

	const activeList = [...active];
	const stale = await getDb()
		.select({
			id: canonicalEntity.id,
			canonicalKey: canonicalEntity.canonicalKey,
			label: canonicalEntity.label,
			entityType: canonicalEntity.entityType
		})
		.from(canonicalEntity)
		.where(and(eq(canonicalEntity.userId, userId), notInArray(canonicalEntity.entityType, activeList)));

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
