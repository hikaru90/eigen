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
 * Performance: relations, entities, memory type, and cues all run in parallel
 * via Promise.allSettled. A pre-computed embedding is threaded through to avoid
 * re-embedding the same text multiple times.
 *
 * The `enriched_at` timestamp is set only when all parallel steps succeed.
 * `enrichment_version` is always incremented on entry.
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
	/** Pre-computed embedding from the fast path — avoids re-embedding the same text. */
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
	}

	// Emit all enrichment progress phases before launching parallel work.
	onProgress?.('relations');
	onProgress?.('entities');
	onProgress?.('memory_type');
	onProgress?.('cues');

	// Run all four enrichment jobs in parallel. Each is independent: they all
	// read from normalizedText + thoughtEmbedding with no cross-dependencies.
	const [relationsResult, entitiesResult, memoryTypeResult, cuesResult] =
		await Promise.allSettled([
			// ---- Relations -------------------------------------------------------
			extractRelations({ userId, thoughtId, normalizedText, embedding: thoughtEmbedding })
				.then(async (relations) => {
					await db.transaction(async (tx) => {
						await tx
							.delete(thoughtRelation)
							.where(eq(thoughtRelation.sourceThoughtId, thoughtId));
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
				}),

			// ---- Entities --------------------------------------------------------
			syncEntityGraphFromThought({ userId, thoughtId, normalizedText, thoughtEmbedding }),

			// ---- Memory type -----------------------------------------------------
			classifyMemoryType({ userId, normalizedText }).then(async (memoryType) => {
				await db.update(thought).set({ memoryType }).where(eq(thought.id, thoughtId));
			}),

			// ---- Cues ------------------------------------------------------------
			extractCues({ userId, normalizedText }).then(async (cues) => {
				if (cues.length > 0) {
					await db.update(thought).set({ cues }).where(eq(thought.id, thoughtId));
				}
			})
		]);

	// Log failures individually so one bad step doesn't hide others.
	const stepNames = ['relations', 'entities', 'memory_type', 'cues'] as const;
	const results = [relationsResult, entitiesResult, memoryTypeResult, cuesResult];
	let allOk = true;

	for (let i = 0; i < results.length; i++) {
		const r = results[i];
		if (r.status === 'rejected') {
			allOk = false;
			console.error(`[enrich] ${stepNames[i]} step failed`, {
				thoughtId,
				message: r.reason instanceof Error ? r.reason.message : String(r.reason)
			});
		}
	}

	// ---- Ontology eval (sequential — depends on thought count) ---------------
	if (thoughtCountAfterInsert !== undefined) {
		try {
			await maybeRefreshUserOntology({
				userId,
				thoughtCountAfterInsert,
				onBeforeEval: () => onProgress?.('ontology_eval')
			});
		} catch (err) {
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
