/**
 * Async enrichment for already-persisted thought rows.
 *
 * The fast path in `captureThought` persists the raw text, embedding, category,
 * and FalkorDB node. This module handles the heavier steps that can run after
 * the HTTP response has been returned to the user:
 *
 *   - thought-to-thought relation extraction + graph sync
 *   - entity mention extraction + canonical resolution + FalkorDB entity edges
 *   - memory type classification
 *   - cue bundle generation
 *   - ontology profile refresh trigger
 *
 * Each step is individually try/caught so a failure in one step does not block
 * the rest. The `enriched_at` timestamp is set only when all steps complete
 * without error. `enrichment_version` is always incremented on entry.
 *
 * Callers MUST NOT await this in the HTTP request handler — fire and forget:
 *   void enrichThought(userId, thoughtId, normalizedText, embedding)
 *
 * The DB connection used here is obtained from `getDb()` directly (not the
 * request-scoped connection from SvelteKit hooks) so it survives past the
 * request lifecycle.
 */

import { eq, sql } from 'drizzle-orm';
import type { CaptureIngestPhase } from '$lib/capture/ingest-phases';
import { thought } from '$lib/server/db/schema';
import { getDb } from '$lib/server/db';
import { extractRelations } from '$lib/server/memory/relation-extraction';
import { syncEntityGraphFromThought } from '$lib/server/memory/entity-graph-sync';
import { classifyMemoryType } from '$lib/server/memory/classify-memory-type';
import { extractCues } from '$lib/server/memory/extract-cues';
import { maybeRefreshUserOntology } from '$lib/server/ontology';
import { upsertThoughtRelation, deleteThoughtOutgoingGraphEdges } from '$lib/server/graph/falkor';
import { thoughtRelation } from '$lib/server/db/schema';

export type EnrichThoughtOptions = {
	onProgress?: (phase: CaptureIngestPhase) => void;
	/** Pre-computed embedding from the fast path — avoids an extra LLM call. */
	thoughtEmbedding?: number[];
	thoughtCountAfterInsert?: number;
};

/**
 * Run all enrichment steps for a thought that has already been persisted.
 * Idempotent: safe to call multiple times (re-runs update enrichment_version).
 *
 * Does NOT throw. All errors are logged individually.
 */
export async function enrichThought(
	userId: string,
	thoughtId: string,
	normalizedText: string,
	options?: EnrichThoughtOptions
): Promise<void> {
	const { onProgress, thoughtEmbedding, thoughtCountAfterInsert } = options ?? {};
	const db = getDb();

	// Bump enrichment version — wrapped in try/catch so a missing column
	// (e.g. migration not yet applied) does not silently block all enrichment steps.
	try {
		await db
			.update(thought)
			.set({ enrichmentVersion: sql`${thought.enrichmentVersion} + 1` })
			.where(eq(thought.id, thoughtId));
	} catch (err) {
		console.warn('[enrich] enrichment_version bump failed (migration pending?)', {
			thoughtId,
			message: err instanceof Error ? err.message : String(err)
		});
		// Continue — do not abort enrichment just because the version bump failed.
	}

	let allOk = true;

	// ---- Relations -----------------------------------------------------------
	try {
		onProgress?.('relations');
		const relations = await extractRelations({ userId, thoughtId, normalizedText });
		await db.transaction(async (tx) => {
			await tx.delete(thoughtRelation).where(eq(thoughtRelation.sourceThoughtId, thoughtId));
			if (relations.length > 0) {
				await tx.insert(thoughtRelation).values(
					relations.map((r) => ({
						userId,
						sourceThoughtId: thoughtId,
						targetThoughtId: r.targetId,
						relationType: r.relationType
					}))
				);
			}
		});
		for (const r of relations) {
			await upsertThoughtRelation({
				userId,
				sourceId: thoughtId,
				targetId: r.targetId,
				relationType: r.relationType
			});
		}
	} catch (err) {
		allOk = false;
		console.error('[enrich] relation extraction failed', {
			thoughtId,
			message: err instanceof Error ? err.message : String(err)
		});
	}

	// ---- Entities ------------------------------------------------------------
	try {
		onProgress?.('entities');
		await syncEntityGraphFromThought({ userId, thoughtId, normalizedText, thoughtEmbedding });
	} catch (err) {
		allOk = false;
		console.error('[enrich] entity graph sync failed', {
			thoughtId,
			message: err instanceof Error ? err.message : String(err)
		});
	}

	// ---- Memory type ---------------------------------------------------------
	try {
		onProgress?.('memory_type');
		const memoryType = await classifyMemoryType({ userId, normalizedText });
		await db
			.update(thought)
			.set({ memoryType })
			.where(eq(thought.id, thoughtId));
	} catch (err) {
		allOk = false;
		console.error('[enrich] memory type classification failed', {
			thoughtId,
			message: err instanceof Error ? err.message : String(err)
		});
	}

	// ---- Cues ----------------------------------------------------------------
	try {
		onProgress?.('cues');
		const cues = await extractCues({ userId, normalizedText });
		if (cues.length > 0) {
			await db
				.update(thought)
				.set({ cues })
				.where(eq(thought.id, thoughtId));
		}
	} catch (err) {
		allOk = false;
		console.error('[enrich] cue extraction failed', {
			thoughtId,
			message: err instanceof Error ? err.message : String(err)
		});
	}

	// ---- Ontology eval -------------------------------------------------------
	if (thoughtCountAfterInsert !== undefined) {
		try {
			await maybeRefreshUserOntology({
				userId,
				thoughtCountAfterInsert,
				onBeforeEval: () => onProgress?.('ontology_eval')
			});
		} catch (err) {
			// Non-fatal: ontology refresh failure never blocks the thought.
			console.error('[enrich] ontology refresh failed', {
				thoughtId,
				message: err instanceof Error ? err.message : String(err)
			});
		}
	}

	// ---- Mark enriched -------------------------------------------------------
	if (allOk) {
		try {
			await db
				.update(thought)
				.set({ enrichedAt: new Date() })
				.where(eq(thought.id, thoughtId));
		} catch (err) {
			console.warn('[enrich] enriched_at write failed (migration pending?)', {
				thoughtId,
				message: err instanceof Error ? err.message : String(err)
			});
		}
	}
}

/**
 * Re-run enrichment for an existing thought (e.g. after an edit or manual relink).
 * Clears outgoing FalkorDB edges first so stale links don't accumulate.
 */
export async function reenrichThought(
	userId: string,
	thoughtId: string,
	normalizedText: string,
	options?: EnrichThoughtOptions
): Promise<void> {
	await deleteThoughtOutgoingGraphEdges({ userId, thoughtId });
	await enrichThought(userId, thoughtId, normalizedText, options);
}
