import { and, desc, eq, isNotNull, lt, or, sql } from 'drizzle-orm';
import type { CaptureIngestPhase } from '$lib/capture/ingest-phases';
import { captureSession, thought, thoughtRelation } from '$lib/server/db/schema';
import { getDb } from '$lib/server/db';
import { logActivityCall } from '$lib/server/activity/log-call';
import { computeLexicalText } from '$lib/server/memory/lexical-text';
import {
	deleteThoughtOutgoingGraphEdges,
	deleteThoughtVertexFromGraph,
	upsertThoughtNode,
	upsertThoughtRelation
} from '$lib/server/graph/falkor';
import { createThoughtEmbedding } from '$lib/server/llm/embedding';
import { extractRelations } from '$lib/server/memory/relation-extraction';
import { syncEntityGraphFromThought } from '$lib/server/memory/entity-graph-sync';
import { maybeRefreshUserOntology, resolveThoughtCategory } from '$lib/server/ontology';
import { ensureUserOntologySeeded } from '$lib/server/ontology-db';
import { enrichThought, reenrichThought } from '$lib/server/capture/enrich';

/** Explicit MVP pricing unit until the LLM ingest path is wired. */
const CAPTURE_BASE_COST_USD = 0.0005;

/** Deterministic text shaping only; kind key + FK come from `resolveThoughtCategory`. */
export function normalizeThoughtText(raw: string): { normalized: string; metadata: Record<string, unknown> } {
	const normalized = raw.trim().replace(/\s+/g, ' ');
	return {
		normalized,
		metadata: { pipeline: 'ontology_llm_v1' }
	};
}

async function logCaptureActivity(
	userId: string,
	operation: 'capture_submit' | 'capture_edit' | 'capture_relink' | 'capture_delete',
	durationMs?: number
) {
	await logActivityCall(getDb(), userId, {
		provider: 'mvp_stub',
		operation,
		baseCostUsd: CAPTURE_BASE_COST_USD,
		durationMs
	});
}

function toPgVectorLiteral(values: number[]): string {
	return `[${values.join(',')}]`;
}

function emitProgress(
	onProgress: ((phase: CaptureIngestPhase) => void) | undefined,
	phase: CaptureIngestPhase
) {
	onProgress?.(phase);
}

export type CaptureThoughtOptions = {
	onProgress?: (phase: CaptureIngestPhase) => void;
};

/**
 * Fast path: classify → embed → persist → FalkorDB node → return immediately.
 *
 * Heavy enrichment (relation extraction, entity graph sync, memory type
 * classification, cue extraction, ontology eval) is fired asynchronously
 * via `enrichThought` and does NOT block the response.
 *
 * If the caller provides an `onProgress` callback, it will receive progress
 * events for the async enrichment phases only when running in the NDJSON
 * streaming mode (where the handler keeps the connection open until the stream
 * is fully flushed). For plain JSON mode, enrichment events are not visible.
 */
export async function captureThought(userId: string, rawInput: string, options?: CaptureThoughtOptions) {
	const captureStart = Date.now();
	const onProgress = options?.onProgress;
	await ensureUserOntologySeeded(getDb(), userId);
	emitProgress(onProgress, 'accounting');
	const { normalized, metadata: baseMeta } = normalizeThoughtText(rawInput);

	// Classify category and embed in parallel — both only need the raw text.
	// This saves one full LLM round-trip vs the previous sequential approach.
	emitProgress(onProgress, 'ontology');
	emitProgress(onProgress, 'embedding');
	const [categoryResult, embedding] = await Promise.all([
		resolveThoughtCategory({ userId, normalized, rawText: rawInput }),
		createThoughtEmbedding(userId, normalized)
	]);
	const { key: category, ontologyEntityKindId, confidence: categoryConfidence, alternatives: categoryAlternatives } = categoryResult;
	const metadata = { ...baseMeta, categorySource: 'llm', categoryConfidence, categoryAlternatives };

	// captureSession + dedup check in parallel — session needs category (just resolved),
	// dedup needs embedding (just resolved). Both are DB-only, no LLM.
	emitProgress(onProgress, 'session');
	const lexicalText = computeLexicalText(normalized);
	const vectorLiteral = toPgVectorLiteral(embedding);

	const [sessionRows, nearestRow] = await Promise.all([
		getDb()
			.insert(captureSession)
			.values({
				userId,
				status: 'accepted',
				rawInput,
				normalizedPreview: normalized,
				category,
				metadataPreview: metadata,
				revisionCount: 0
			})
			.returning(),
		// Near-duplicate detection (non-fatal, wrapped so sync throws become rejections)
		Promise.resolve()
			.then(() =>
				getDb()
					.select({
						id: thought.id,
						normalizedText: thought.normalizedText,
						distance: sql<number>`${thought.embedding} <=> ${vectorLiteral}::vector`
					})
					.from(thought)
					.where(and(eq(thought.userId, userId), isNotNull(thought.embedding)))
					.orderBy(sql`${thought.embedding} <=> ${vectorLiteral}::vector`)
					.limit(1)
			)
			.catch((err: unknown) => {
				console.warn('[capture.dedup] dedup check failed, proceeding', {
					message: err instanceof Error ? err.message : String(err)
				});
				return [] as Array<{ id: string; normalizedText: string; distance: number }>;
			})
	]);

	const sessionRow = sessionRows[0];
	const nearest = nearestRow[0];
	let nearDuplicateMeta: { id: string; distance: number; preview: string } | undefined;
	if (nearest && typeof nearest.distance === 'number' && nearest.distance < 0.06) {
		nearDuplicateMeta = {
			id: nearest.id,
			distance: nearest.distance,
			preview: nearest.normalizedText.slice(0, 120)
		};
		console.info('[capture.dedup] near-duplicate detected', {
			existingId: nearest.id,
			distance: nearest.distance
		});
	}

	emitProgress(onProgress, 'persist');
	const [stored] = await getDb().transaction(async (tx) => {
		const [t] = await tx
			.insert(thought)
			.values({
				userId,
				rawText: rawInput,
				normalizedText: normalized,
				lexicalText,
				category,
				ontologyEntityKindId,
				metadata: {
					...metadata,
					captureSessionId: sessionRow.id,
					...(nearDuplicateMeta ? { nearDuplicate: nearDuplicateMeta } : {})
				},
				embedding: sql`${toPgVectorLiteral(embedding)}::vector`
			})
			.returning({
				id: thought.id,
				userId: thought.userId,
				rawText: thought.rawText,
				normalizedText: thought.normalizedText,
				lexicalText: thought.lexicalText,
				category: thought.category,
				metadata: thought.metadata
			});
		return [t];
	});

	// Fast path: sync the FalkorDB node (lightweight, no LLM calls).
	emitProgress(onProgress, 'graph');
	await upsertThoughtNode({
		id: stored.id,
		userId,
		rawText: stored.rawText,
		normalizedText: stored.normalizedText,
		lexicalText: stored.lexicalText,
		category: stored.category
	});

	await logCaptureActivity(userId, 'capture_submit', Date.now() - captureStart);

	// Count thoughts for optional ontology eval trigger.
	const [countRow] = await getDb()
		.select({ n: sql<number>`count(*)::int` })
		.from(thought)
		.where(eq(thought.userId, userId));
	const thoughtCountAfterInsert = Number(countRow?.n ?? 0);

	const enrichOptions = { onProgress, thoughtEmbedding: embedding, thoughtCountAfterInsert };

	if (onProgress) {
		// UI / NDJSON path: the user is watching progress — run enrichment synchronously
		// so the graph is fully connected before the "done" event is emitted.
		await enrichThought(userId, stored.id, stored.normalizedText, enrichOptions);
	} else {
		// MCP / plain-JSON path: fire-and-forget for fast response.
		void enrichThought(userId, stored.id, stored.normalizedText, enrichOptions);
	}

	return stored;
}

export type EditStoredThoughtOptions = {
	onProgress?: (phase: CaptureIngestPhase) => void;
};

export async function editStoredThought(
	userId: string,
	thoughtId: string,
	editRequest: string,
	options?: EditStoredThoughtOptions
) {
	const editStart = Date.now();
	const onProgress = options?.onProgress;
	await ensureUserOntologySeeded(getDb(), userId);
	emitProgress(onProgress, 'accounting');

	const [existing] = await getDb()
		.select()
		.from(thought)
		.where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))
		.limit(1);

	if (!existing) {
		await logCaptureActivity(userId, 'capture_edit', Date.now() - editStart);
		return { ok: false as const, reason: 'not_found' as const };
	}

	const editedRaw = editRequest.trim();
	const { normalized, metadata: baseMeta } = normalizeThoughtText(editedRaw);
	emitProgress(onProgress, 'ontology');
	const { key: category, ontologyEntityKindId, confidence: categoryConfidence, alternatives: categoryAlternatives } = await resolveThoughtCategory({
		userId,
		normalized,
		rawText: editedRaw
	});
	const metadata = { ...baseMeta, categorySource: 'llm', categoryConfidence, categoryAlternatives };
	const lexicalText = computeLexicalText(normalized);
	emitProgress(onProgress, 'embedding');
	const embedding = await createThoughtEmbedding(userId, normalized);

	emitProgress(onProgress, 'persist');
	const [updated] = await getDb()
		.update(thought)
		.set({
			rawText: editedRaw,
			normalizedText: normalized,
			lexicalText,
			embedding: sql`${toPgVectorLiteral(embedding)}::vector`,
			category,
			ontologyEntityKindId,
			// Reset enrichment state so background job re-runs on the new text.
			enrichedAt: null,
			metadata: {
				...(existing.metadata as Record<string, unknown>),
				...metadata,
				lastEditRequest: editRequest.trim()
			},
			updatedAt: new Date()
		})
		.where(eq(thought.id, thoughtId))
		.returning({
			id: thought.id,
			userId: thought.userId,
			rawText: thought.rawText,
			normalizedText: thought.normalizedText,
			lexicalText: thought.lexicalText,
			category: thought.category,
			metadata: thought.metadata
		});

	// Fast path: sync FalkorDB node with new text.
	emitProgress(onProgress, 'graph');
	await upsertThoughtNode({
		id: updated!.id,
		userId,
		rawText: updated!.rawText,
		normalizedText: updated!.normalizedText,
		lexicalText: updated!.lexicalText,
		category: updated!.category
	});

	await logCaptureActivity(userId, 'capture_edit', Date.now() - editStart);

	// Same pattern as capture: await when user is watching (UI path), fire-and-forget otherwise.
	if (onProgress) {
		await reenrichThought(userId, updated!.id, updated!.normalizedText, {
			onProgress,
			thoughtEmbedding: embedding
		});
	} else {
		void reenrichThought(userId, updated!.id, updated!.normalizedText, {
			thoughtEmbedding: embedding
		});
	}

	return { ok: true as const, thought: updated! };
}

export type RelinkThoughtGraphOptions = {
	onProgress?: (phase: CaptureIngestPhase) => void;
};

/**
 * Re-runs relation + entity graph sync for an existing thought without changing
 * stored text. Clears outgoing Falkor edges first so removed links don't linger.
 */
export async function relinkThoughtGraph(
	userId: string,
	thoughtId: string,
	options?: RelinkThoughtGraphOptions
) {
	const started = Date.now();
	const onProgress = options?.onProgress;
	await ensureUserOntologySeeded(getDb(), userId);
	emitProgress(onProgress, 'accounting');

	const [existing] = await getDb()
		.select()
		.from(thought)
		.where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))
		.limit(1);

	if (!existing) {
		await logCaptureActivity(userId, 'capture_relink', Date.now() - started);
		return { ok: false as const, reason: 'not_found' as const };
	}

	// Sync the node first (fast, no LLM).
	emitProgress(onProgress, 'graph');
	await upsertThoughtNode({
		id: existing.id,
		userId,
		rawText: existing.rawText,
		normalizedText: existing.normalizedText,
		lexicalText: existing.lexicalText,
		category: existing.category
	});

	await logCaptureActivity(userId, 'capture_relink', Date.now() - started);

	if (onProgress) {
		await reenrichThought(userId, existing.id, existing.normalizedText, { onProgress });
	} else {
		void reenrichThought(userId, existing.id, existing.normalizedText);
	}

	return {
		ok: true as const,
		thought: {
			id: existing.id,
			userId: existing.userId,
			rawText: existing.rawText,
			normalizedText: existing.normalizedText,
			lexicalText: existing.lexicalText,
			category: existing.category,
			metadata: existing.metadata as Record<string, unknown>
		}
	};
}

/**
 * Removes a thought from Falkor first (so a failed DB step can be repaired with relink),
 * then deletes the Postgres row (cascades `thought_relation` and `entity_resolution_log`).
 */
export async function deleteThoughtForUser(userId: string, thoughtId: string) {
	const started = Date.now();
	await ensureUserOntologySeeded(getDb(), userId);

	const [existing] = await getDb()
		.select({ id: thought.id })
		.from(thought)
		.where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))
		.limit(1);

	if (!existing) {
		await logCaptureActivity(userId, 'capture_delete', Date.now() - started);
		return { ok: false as const, reason: 'not_found' as const };
	}

	await deleteThoughtVertexFromGraph({ userId, thoughtId: existing.id });

	await getDb().delete(thought).where(and(eq(thought.id, existing.id), eq(thought.userId, userId)));

	await logCaptureActivity(userId, 'capture_delete', Date.now() - started);
	return { ok: true as const };
}

export async function listThoughts(
	userId: string,
	options?: {
		limit?: number;
		cursor?: { createdAt: Date; id: string };
	}
) {
	const limit = Math.max(1, Math.min(options?.limit ?? 20, 100));
	const cursor = options?.cursor;

	return getDb()
		.select()
		.from(thought)
		.where(
			and(
				eq(thought.userId, userId),
				cursor
					? or(
							lt(thought.createdAt, cursor.createdAt),
							and(eq(thought.createdAt, cursor.createdAt), lt(thought.id, cursor.id))
						)
					: undefined
			)
		)
		.orderBy(desc(thought.createdAt), desc(thought.id))
		.limit(limit);
}
