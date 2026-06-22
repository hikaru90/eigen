import { and, desc, eq, inArray, isNotNull, notInArray, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
	canonicalEntity,
	entityAlias,
	entityResolutionLog,
	projectProfile,
	thought,
	thoughtEntity
} from '$lib/server/db/schema';
import { deleteEntityVertexFromGraph, upsertEntityNode, upsertMentionEdge } from '$lib/server/graph/age';
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
 * Rewrites `canonical_entity.entity_type` (and AGE `entity_type`) when the stored value is not
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
	const mentionRows = await getDb()
		.selectDistinct({ thoughtId: entityResolutionLog.thoughtId })
		.from(entityResolutionLog)
		.where(
			and(
				eq(entityResolutionLog.userId, userId),
				eq(entityResolutionLog.canonicalEntityId, row.id)
			)
		);
	for (const mention of mentionRows) {
		if (!mention.thoughtId) continue;
		await upsertMentionEdge({
			userId,
			thoughtId: mention.thoughtId,
			entityId: row.id
		});
	}
	return { ok: true };
}

/** Removes canonical entities (and AGE vertices) that no longer have any thought links. */
export async function pruneCanonicalEntitiesWithNoThoughtLinks(
	userId: string,
	candidateEntityIds: string[]
): Promise<number> {
	const uniqueIds = [...new Set(candidateEntityIds.map((id) => id.trim()).filter((id) => id.length > 0))];
	if (uniqueIds.length === 0) return 0;

	const stillLinked = await getDb()
		.selectDistinct({ entityId: thoughtEntity.entityId })
		.from(thoughtEntity)
		.where(and(eq(thoughtEntity.userId, userId), inArray(thoughtEntity.entityId, uniqueIds)));
	const stillLinkedSet = new Set(stillLinked.map((row) => row.entityId));

	let removed = 0;
	for (const entityId of uniqueIds) {
		if (stillLinkedSet.has(entityId)) continue;
		const result = await deleteCanonicalEntityForUser(userId, entityId);
		if (result.ok) removed++;
	}
	return removed;
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

const DEDUP_DISTANCE_THRESHOLD = 0.08;
const DEDUP_CANDIDATE_LIMIT = 200;
const EMBEDDING_DIMENSIONS = 1536;

function toVectorLiteral(vector: number[]): string {
	return `[${vector.join(',')}]`;
}

function toVectorSql(vector: number[]) {
	if (vector.length !== EMBEDDING_DIMENSIONS) {
		throw new Error(
			`Invalid canonical entity embedding length: ${vector.length}. Expected ${EMBEDDING_DIMENSIONS}.`
		);
	}
	if (!vector.every((n) => Number.isFinite(n))) {
		throw new Error('Invalid canonical entity embedding: expected finite values');
	}
	return sql.raw(`'${toVectorLiteral(vector)}'::vector`);
}

export type ConsolidateCanonicalEntityAliasesResult = {
	scanned: number;
	candidates: number;
	merged: number;
};

/**
 * Nightly dedup pass: merge very-close duplicate canonical entities and keep
 * prior keys as aliases on the surviving entity.
 */
export async function consolidateCanonicalEntityAliasesForUser(
	userId: string
): Promise<ConsolidateCanonicalEntityAliasesResult> {
	const db = getDb();
	const profileRows = await db
		.select({ entityId: projectProfile.projectEntityId })
		.from(projectProfile)
		.where(eq(projectProfile.userId, userId));
	const gtdProjectEntityIds = profileRows.map((row) => row.entityId);

	const rows = await db
		.select({
			id: canonicalEntity.id,
			canonicalKey: canonicalEntity.canonicalKey,
			entityType: canonicalEntity.entityType,
			embedding: canonicalEntity.embedding,
			createdAt: canonicalEntity.createdAt
		})
		.from(canonicalEntity)
		.where(
			and(
				eq(canonicalEntity.userId, userId),
				isNotNull(canonicalEntity.embedding),
				...(gtdProjectEntityIds.length > 0
					? [notInArray(canonicalEntity.id, gtdProjectEntityIds)]
					: [])
			)
		)
		.orderBy(desc(canonicalEntity.createdAt))
		.limit(DEDUP_CANDIDATE_LIMIT);

	const available = rows.filter(
		(row): row is typeof row & { embedding: number[] } => Array.isArray(row.embedding)
	);
	if (available.length < 2) return { scanned: available.length, candidates: 0, merged: 0 };

	const mergedIds = new Set<string>();
	let candidates = 0;
	let merged = 0;

	for (const row of available) {
		if (mergedIds.has(row.id)) continue;
		let vectorSql;
		try {
			vectorSql = toVectorSql(row.embedding);
		} catch {
			continue;
		}
		const distanceExpr = sql<number>`${canonicalEntity.embedding} <=> ${vectorSql}`;
		const [nearest] = await db
			.select({
				id: canonicalEntity.id,
				canonicalKey: canonicalEntity.canonicalKey,
				entityType: canonicalEntity.entityType,
				createdAt: canonicalEntity.createdAt,
				distance: distanceExpr
			})
			.from(canonicalEntity)
			.where(
				and(
					eq(canonicalEntity.userId, userId),
					isNotNull(canonicalEntity.embedding),
					eq(canonicalEntity.entityType, row.entityType),
					sql`${canonicalEntity.id} <> ${row.id}`,
					...(gtdProjectEntityIds.length > 0
						? [notInArray(canonicalEntity.id, gtdProjectEntityIds)]
						: [])
				)
			)
			.orderBy(distanceExpr)
			.limit(1);

		if (!nearest || typeof nearest.distance !== 'number' || nearest.distance > DEDUP_DISTANCE_THRESHOLD) {
			continue;
		}
		if (mergedIds.has(nearest.id)) continue;

		candidates++;
		const primary = row.createdAt <= nearest.createdAt ? row : nearest;
		const secondary = primary.id === row.id ? nearest : row;
		mergedIds.add(secondary.id);

		await db
			.update(entityResolutionLog)
			.set({ canonicalEntityId: primary.id })
			.where(
				and(
					eq(entityResolutionLog.userId, userId),
					eq(entityResolutionLog.canonicalEntityId, secondary.id)
				)
			);

		await db
			.insert(entityAlias)
			.values({
				userId,
				canonicalEntityId: primary.id,
				aliasText: secondary.canonicalKey
			})
			.onConflictDoNothing();

		await syncCanonicalEntityVertexToGraph(userId, primary.id);
		await deleteEntityVertexFromGraph({ userId, entityId: secondary.id });
		await db
			.delete(canonicalEntity)
			.where(and(eq(canonicalEntity.userId, userId), eq(canonicalEntity.id, secondary.id)));
		merged++;
	}

	return { scanned: available.length, candidates, merged };
}
