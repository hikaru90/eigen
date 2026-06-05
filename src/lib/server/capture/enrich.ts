/**
 * Async enrichment for already-persisted thought rows.
 *
 * The fast path in `captureThought` persists the raw text, embedding, category,
 * and an Apache AGE provenance anchor (thought id only). This module handles the heavier steps:
 *
 *   - With NDJSON `onProgress`: awaited on the caller's DB connection.
 *   - Without `onProgress`: scheduled via `scheduleEnrichThought` on a dedicated
 *     RLS-scoped connection (`withDbUser`).
 *
 *   - thought-to-thought relation extraction + graph sync
 *   - entity mention extraction + canonical resolution + AGE entity edges
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

import { and, eq, sql } from 'drizzle-orm';
import type { CaptureIngestPhase } from '$lib/capture/ingest-phases';
import type { CaptureProgressEvent } from '$lib/server/capture/service';
import { thought } from '$lib/server/db/schema';
import { getDb, withDbUser } from '$lib/server/db';
import { extractRelations } from '$lib/server/memory/relation-extraction';
import { shouldRetryEntityMentionExtraction } from '$lib/server/memory/entity-extraction';
import { syncEntityGraphFromThought } from '$lib/server/memory/entity-graph-sync';
import { extractThoughtMetadata } from '$lib/server/memory/extract-thought-metadata';
import { getTemporalAnchorTimezone } from '$lib/server/memory/temporal-anchor-timezone';
import { syncTemporalEventsFromThought } from '$lib/server/memory/temporal-graph-sync';
import { maybeRefreshUserOntology } from '$lib/server/ontology';
import {
	deleteThoughtOutgoingGraphEdges,
	deleteThoughtOutgoingRelatesToEdges,
	upsertThoughtRelation
} from '$lib/server/graph/age';
import { thoughtRelation } from '$lib/server/db/schema';
import { materializeRetrievalLinksForThought } from '$lib/server/retrieval/materialize-links';
import { scheduleIncrementalConsolidation } from '$lib/server/consolidation/incremental-consolidation';

export type EnrichThoughtOptions = {
	onProgress?: (event: CaptureProgressEvent) => Promise<void>;
	/** Pre-computed embedding from the fast path — avoids re-embedding the same text. */
	thoughtEmbedding?: number[];
	thoughtCountAfterInsert?: number;
	/** Entity hints loaded before persist — threaded into entity extraction. */
	preloadedKnownEntities?: Array<{ label: string; entityType: string }>;
};

/**
 * Run enrichment on a dedicated RLS-scoped DB connection (fire-and-forget).
 * Use when the HTTP handler will release its request connection before enrich finishes.
 */
export function scheduleEnrichThought(
	userId: string,
	thoughtId: string,
	normalizedText: string,
	options?: EnrichThoughtOptions
): void {
	void withDbUser(userId, () =>
		enrichThought(userId, thoughtId, normalizedText, options)
	).catch((err) => {
		console.error('[enrich] scheduled enrichment failed', {
			thoughtId,
			userId,
			message: err instanceof Error ? err.message : String(err)
		});
	});
}

/**
 * Re-run enrichment on a dedicated RLS-scoped DB connection (fire-and-forget).
 */
export function scheduleReenrichThought(
	userId: string,
	thoughtId: string,
	normalizedText: string,
	options?: EnrichThoughtOptions
): void {
	void withDbUser(userId, () =>
		reenrichThought(userId, thoughtId, normalizedText, options)
	).catch((err) => {
		console.error('[enrich] scheduled re-enrichment failed', {
			thoughtId,
			userId,
			message: err instanceof Error ? err.message : String(err)
		});
	});
}

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
	const { onProgress, thoughtEmbedding, thoughtCountAfterInsert, preloadedKnownEntities } =
		options ?? {};
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

	// Emit a single parallel-group event so the UI shows all four enrichment
	// phases as a concurrent cluster rather than four instantaneous sequential steps.
	await onProgress?.({
		parallel: true,
		phases: ['relations', 'entities', 'temporal', 'memory_type', 'cues']
	});

	const [relationsResult, entitiesResult, metadataResult] = await Promise.allSettled([
			// ---- Relations -------------------------------------------------------
			(async () => {
				await deleteThoughtOutgoingRelatesToEdges({ userId, thoughtId });
				const relations = await extractRelations({ userId, thoughtId, normalizedText, embedding: thoughtEmbedding });
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
			})(),

			// ---- Entities --------------------------------------------------------
			(async () => {
				const { mentionCount } = await syncEntityGraphFromThought({
					userId,
					thoughtId,
					normalizedText,
					preloadedKnownEntities
				});
				if (mentionCount === 0 && shouldRetryEntityMentionExtraction(normalizedText)) {
					throw new Error(
						`entity graph sync produced zero mentions (${normalizedText.trim().length} chars)`
					);
				}
			})(),

			// ---- Memory type + cues (single LLM call) ----------------------------
			(async () => {
				const { memoryType, cues } = await extractThoughtMetadata({ userId, normalizedText });
				await db
					.update(thought)
					.set({
						memoryType,
						...(cues.length > 0 ? { cues } : {})
					})
					.where(eq(thought.id, thoughtId));
			})()
		]);

	// Temporal graph sync reads entity_resolution_log — run after entity step completes.
	const [thoughtRow] = await db
		.select({ createdAt: thought.createdAt })
		.from(thought)
		.where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))
		.limit(1);
	const capturedAt = thoughtRow?.createdAt ?? new Date();

	const temporalResult = await Promise.allSettled([
		syncTemporalEventsFromThought({
			userId,
			thoughtId,
			normalizedText,
			thoughtEmbedding,
			capturedAt,
			timezone: getTemporalAnchorTimezone(userId)
		})
	]).then((r) => r[0]);

	// Log failures individually so one bad step doesn't hide others.
	const stepNames = ['relations', 'entities', 'temporal', 'metadata'] as const;
	const results = [relationsResult, entitiesResult, temporalResult, metadataResult];
	let allOk = true;

	for (let i = 0; i < results.length; i++) {
		const r = results[i];
		if (r.status === 'rejected') {
			allOk = false;
			console.error(`[enrich] ${stepNames[i]} step failed`, {
				thoughtId,
				message: r.reason instanceof Error ? r.reason.message : String(r.reason)
			});
			if (stepNames[i] === 'entities') {
				try {
					await db
						.update(thought)
						.set({ enrichedAt: null })
						.where(eq(thought.id, thoughtId));
				} catch (clearErr) {
					console.warn('[enrich] failed to clear enriched_at after entity step failure', {
						thoughtId,
						message: clearErr instanceof Error ? clearErr.message : String(clearErr)
					});
				}
			}
		}
	}

	// ---- Ontology eval (sequential — depends on thought count) ---------------
	if (thoughtCountAfterInsert !== undefined) {
		try {
			await maybeRefreshUserOntology({
				userId,
				thoughtCountAfterInsert,
				onBeforeEval: async () => { await onProgress?.({ parallel: false, phase: 'ontology_eval' }); }
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
			await materializeRetrievalLinksForThought({
				userId,
				thoughtId,
				normalizedText
			});
		} catch (err) {
			console.error('[enrich] retrieval link materialization failed', {
				thoughtId,
				message: err instanceof Error ? err.message : String(err)
			});
		}

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

		scheduleIncrementalConsolidation(userId, thoughtId);
	}
}

/**
 * Re-run enrichment for an existing thought (e.g. after an edit or manual relink).
 * Clears outgoing AGE graph edges first so stale links don't accumulate.
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
