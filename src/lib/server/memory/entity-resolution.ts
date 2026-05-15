import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { createThoughtEmbedding } from '$lib/server/llm/embedding';
import { getDb } from '$lib/server/db';
import { canonicalEntity, entityAlias, entityResolutionLog } from '$lib/server/db/schema';
import { computeLexicalText } from '$lib/server/memory/lexical-text';

/** Cosine distance threshold on pgvector `<=>`; lower is closer (conservative merge). */
const MERGE_DISTANCE_THRESHOLD = 0.22;
const EMBEDDING_DIMENSIONS = 1536;

function toVectorLiteral(vector: number[]): string {
	return `[${vector.join(',')}]`;
}

function toVectorSql(vector: number[]) {
	const safe = vector.every((n) => Number.isFinite(n));
	if (!safe) {
		throw new Error('Invalid embedding vector: expected finite numeric values');
	}
	if (vector.length !== EMBEDDING_DIMENSIONS) {
		throw new Error(
			`Invalid embedding vector length: ${vector.length}. Expected ${EMBEDDING_DIMENSIONS}.`
		);
	}
	return sql.raw(`'${toVectorLiteral(vector)}'::vector`);
}

async function readCanonicalEmbeddingDiagnostics(userId: string): Promise<{
	columnType: string | null;
	storedDims: number | null;
	nonNullEmbeddings: number | null;
}> {
	try {
		const db = getDb();
		const rel = await db.execute(sql<{ relname: string | null }>`
			select to_regclass('public.canonical_entity')::text as relname
		`);
		const relationExists = Boolean(rel.rows[0]?.relname);
		if (!relationExists) {
			return {
				columnType: null,
				storedDims: null,
				nonNullEmbeddings: null
			};
		}

		const diag = await db.execute(sql<{
			column_type: string | null;
			stored_dims: number | null;
			non_null_embeddings: number | null;
		}>`
			select
				(
					select format_type(a.atttypid, a.atttypmod)
					from pg_attribute a
					join pg_class c on a.attrelid = c.oid
					join pg_namespace n on c.relnamespace = n.oid
					where n.nspname = 'public'
						and c.relname = 'canonical_entity'
						and a.attname = 'embedding'
						and a.attnum > 0
						and not a.attisdropped
				) as column_type,
				(
					select vector_dims(ce.embedding)
					from public.canonical_entity ce
					where ce.user_id = ${userId}
						and ce.embedding is not null
					limit 1
				) as stored_dims,
				(
					select count(*)::int
					from public.canonical_entity ce
					where ce.user_id = ${userId}
						and ce.embedding is not null
				) as non_null_embeddings
		`);
		const row = diag.rows[0];
		return {
			columnType: row?.column_type ?? null,
			storedDims: row?.stored_dims ?? null,
			nonNullEmbeddings: row?.non_null_embeddings ?? null
		};
	} catch {
		return {
			columnType: null,
			storedDims: null,
			nonNullEmbeddings: null
		};
	}
}

export function canonicalKeyFromSurface(surface: string): string {
	return computeLexicalText(surface.trim());
}

export type ResolveCanonicalResult = {
	entityId: string;
	canonicalKey: string;
	decision: 'created' | 'merged';
};

async function insertResolutionLog(input: {
	userId: string;
	thoughtId: string;
	surface: string;
	entityId: string | null;
	decision: string;
	confidence: string;
	metadata: Record<string, unknown>;
}) {
	await getDb().insert(entityResolutionLog).values({
		userId: input.userId,
		thoughtId: input.thoughtId,
		mentionSurface: input.surface,
		canonicalEntityId: input.entityId,
		decision: input.decision,
		confidence: input.confidence,
		metadata: input.metadata
	});
}

export async function resolveOrCreateCanonicalEntity(input: {
	userId: string;
	thoughtId: string;
	surface: string;
	entityType: string;
	confidence: number;
}): Promise<ResolveCanonicalResult> {
	const key = canonicalKeyFromSurface(input.surface);
	const confStr = input.confidence.toFixed(4);

	const [byKey] = await getDb()
		.select({
			id: canonicalEntity.id,
			canonicalKey: canonicalEntity.canonicalKey,
			label: canonicalEntity.label
		})
		.from(canonicalEntity)
		.where(and(eq(canonicalEntity.userId, input.userId), eq(canonicalEntity.canonicalKey, key)))
		.limit(1);

	if (byKey) {
		await getDb()
			.update(canonicalEntity)
			.set({ entityType: input.entityType })
			.where(and(eq(canonicalEntity.userId, input.userId), eq(canonicalEntity.id, byKey.id)));
		await insertResolutionLog({
			userId: input.userId,
			thoughtId: input.thoughtId,
			surface: input.surface,
			entityId: byKey.id,
			decision: 'merged',
			confidence: confStr,
			metadata: { reason: 'canonical_key_match' }
		});
		return { entityId: byKey.id, canonicalKey: byKey.canonicalKey, decision: 'merged' };
	}

	const [byAlias] = await getDb()
		.select({
			entityId: entityAlias.canonicalEntityId,
			canonicalKey: canonicalEntity.canonicalKey
		})
		.from(entityAlias)
		.innerJoin(canonicalEntity, eq(entityAlias.canonicalEntityId, canonicalEntity.id))
		.where(and(eq(entityAlias.userId, input.userId), eq(entityAlias.aliasText, key)))
		.limit(1);

	if (byAlias) {
		await getDb()
			.update(canonicalEntity)
			.set({ entityType: input.entityType })
			.where(and(eq(canonicalEntity.userId, input.userId), eq(canonicalEntity.id, byAlias.entityId)));
		await insertResolutionLog({
			userId: input.userId,
			thoughtId: input.thoughtId,
			surface: input.surface,
			entityId: byAlias.entityId,
			decision: 'merged',
			confidence: confStr,
			metadata: { reason: 'alias_match' }
		});
		return {
			entityId: byAlias.entityId,
			canonicalKey: byAlias.canonicalKey,
			decision: 'merged'
		};
	}

	const embedding = await createThoughtEmbedding(input.userId, input.surface);
	const vectorSql = toVectorSql(embedding);
	const distanceExpr = sql<number>`${canonicalEntity.embedding} <=> ${vectorSql}`;

	const nearest = await getDb()
		.select({
			id: canonicalEntity.id,
			canonicalKey: canonicalEntity.canonicalKey,
			label: canonicalEntity.label,
			distance: distanceExpr
		})
		.from(canonicalEntity)
		.where(and(eq(canonicalEntity.userId, input.userId), isNotNull(canonicalEntity.embedding)))
		.orderBy(distanceExpr)
		.limit(5);

	const best = nearest[0];
	if (
		best &&
		typeof best.distance === 'number' &&
		best.distance < MERGE_DISTANCE_THRESHOLD
	) {
		const [aliasExists] = await getDb()
			.select({ id: entityAlias.id })
			.from(entityAlias)
			.where(and(eq(entityAlias.userId, input.userId), eq(entityAlias.aliasText, key)))
			.limit(1);
		if (!aliasExists) {
			await getDb().insert(entityAlias).values({
				userId: input.userId,
				canonicalEntityId: best.id,
				aliasText: key
			});
		}
		await getDb()
			.update(canonicalEntity)
			.set({ entityType: input.entityType })
			.where(and(eq(canonicalEntity.userId, input.userId), eq(canonicalEntity.id, best.id)));
		await insertResolutionLog({
			userId: input.userId,
			thoughtId: input.thoughtId,
			surface: input.surface,
			entityId: best.id,
			decision: 'merged',
			confidence: confStr,
			metadata: { reason: 'embedding_neighbor', distance: best.distance }
		});
		return {
			entityId: best.id,
			canonicalKey: best.canonicalKey,
			decision: 'merged'
		};
	}

	const [created] = await getDb()
		.insert(canonicalEntity)
		.values({
			userId: input.userId,
			canonicalKey: key,
			label: input.surface.trim(),
			entityType: input.entityType,
			embedding
		})
		.returning();

	if (!created) {
		throw new Error('resolveOrCreateCanonicalEntity: insert returned no row');
	}

	await getDb().insert(entityAlias).values({
		userId: input.userId,
		canonicalEntityId: created.id,
		aliasText: key
	});

	await insertResolutionLog({
		userId: input.userId,
		thoughtId: input.thoughtId,
		surface: input.surface,
		entityId: created.id,
		decision: 'created',
		confidence: confStr,
		metadata: { entityType: input.entityType }
	});

	return {
		entityId: created.id,
		canonicalKey: created.canonicalKey,
		decision: 'created'
	};
}

export async function matchCanonicalEntitiesByEmbedding(input: {
	userId: string;
	embedding: number[];
	limit: number;
}): Promise<Array<{ id: string; label: string; entityType: string; distance: number }>> {
	const limit = Math.max(1, Math.min(input.limit, 32));
	const vectorSql = toVectorSql(input.embedding);
	const distanceExpr = sql<number>`${canonicalEntity.embedding} <=> ${vectorSql}`;
	let rows: Array<{ id: string; label: string; entityType: string; distance: number | null }> = [];
	try {
		rows = await getDb()
			.select({
				id: canonicalEntity.id,
				label: canonicalEntity.label,
				entityType: canonicalEntity.entityType,
				distance: distanceExpr
			})
			.from(canonicalEntity)
			.where(and(eq(canonicalEntity.userId, input.userId), isNotNull(canonicalEntity.embedding)))
			.orderBy(distanceExpr)
			.limit(limit);
	} catch (error) {
		const diagnostics = await readCanonicalEmbeddingDiagnostics(input.userId);
		const err = error as {
			message?: string;
			code?: string;
			detail?: string;
			hint?: string;
			where?: string;
		};
		console.error('[entity-resolution] canonical embedding similarity query failed', {
			userId: input.userId,
			queryEmbeddingLength: input.embedding.length,
			queryEmbeddingPreview: input.embedding.slice(0, 8),
			columnType: diagnostics.columnType,
			storedDims: diagnostics.storedDims,
			nonNullEmbeddings: diagnostics.nonNullEmbeddings,
			errorCode: err.code,
			errorMessage: err.message,
			errorDetail: err.detail,
			errorHint: err.hint,
			errorWhere: err.where
		});
		if (err.code === '42P01') {
			throw new Error(
				'Missing table `public.canonical_entity`. Run database migrations before using entity graph retrieval.'
			);
		}
		throw error;
	}

	return rows
		.filter((r) => typeof r.distance === 'number')
		.map((r) => ({
			id: r.id,
			label: r.label,
			entityType: r.entityType,
			distance: r.distance as number
		}));
}
