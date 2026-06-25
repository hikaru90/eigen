/**
 * Async enrichment for already-persisted thought rows.
 *
 * The fast path in `captureThought` persists the raw text, embedding, category,
 * and an Apache AGE provenance anchor (thought id only). This module handles the heavier steps:
 *
 *   - Capture/edit callers await this module on the request connection when `awaitEnrichment`.
 *   - Default capture schedules enrichment on a dedicated RLS-scoped connection (`withDbUser`).
 *
 *   - thought-to-thought relation extraction + graph sync
 *   - entity mention extraction + canonical resolution + AGE entity edges
 *   - memory type classification
 *   - cue bundle generation
 *   - ontology profile refresh trigger
 *
 * Performance: entities, memory type, and cues run in parallel via Promise.allSettled.
 * Relations run after core enrich completes. A pre-computed embedding is threaded
 * through to avoid re-embedding the same text multiple times.
 *
 * The `enriched_at` timestamp is set only when all parallel steps succeed.
 * `enrichment_version` is always incremented on entry.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { CaptureProgressEvent } from '$lib/server/capture/service';
import type { IngestPhase, IngestPhaseTimer } from '$lib/server/capture/phase-timing';
import { thought } from '$lib/server/db/schema';
import { getDb, withDbUser } from '$lib/server/db';
import { extractRelations } from '$lib/server/memory/relation-extraction';
import { shouldRetryEntityMentionExtraction } from '$lib/server/memory/entity-extraction';
import { syncEntityGraphFromThought } from '$lib/server/memory/entity-graph-sync';
import {
	extractThoughtMetadata,
	type ThoughtMetadataExtraction
} from '$lib/server/memory/extract-thought-metadata';
import type {
	ExtractedEntityMention,
	ExtractedEntityTriple
} from '$lib/server/memory/entity-extraction';
import type { ExtractedTemporalMention } from '$lib/server/memory/temporal-normalize';
import { getUserPreferredTimezone } from '$lib/server/memory/user-timezone';
import { syncTemporalEventsFromThought } from '$lib/server/memory/temporal-graph-sync';
import { maybeRefreshUserOntology } from '$lib/server/ontology';
import {
	deleteThoughtOutgoingGraphEdges,
	deleteThoughtOutgoingRelatesToEdges,
	upsertThoughtRelation
} from '$lib/server/graph/age';
import { thoughtRelation } from '$lib/server/db/schema';
import { materializeRetrievalLinksForThought, syncThoughtNeighborLinks } from '$lib/server/retrieval/materialize-links';
import { scheduleIncrementalConsolidation } from '$lib/server/consolidation/incremental-consolidation';
import { applyGtdAssignment } from '$lib/server/memory/extract-gtd-assignment';
import { reconcileUserProjects } from '$lib/server/memory/reconcile-user-projects';
import { countGtdProjectProfilesForUser } from '$lib/server/memory/project-eligibility';
import { maybeNotifyGroundingQuestionPush } from '$lib/server/grounding/notify-question';

export type EnrichThoughtOptions = {
	onProgress?: (event: CaptureProgressEvent) => Promise<void>;
	/** Pre-computed embedding from the fast path — avoids re-embedding the same text. */
	thoughtEmbedding?: number[];
	thoughtCountAfterInsert?: number;
	/** Entity hints loaded before persist — threaded into entity extraction. */
	preloadedKnownEntities?: Array<{ label: string; entityType: string }>;
	/** Pre-fetched batch LLM results — skip redundant extraction calls. */
	precomputedEntityGraph?: { mentions: ExtractedEntityMention[]; triples: ExtractedEntityTriple[] };
	precomputedMetadata?: ThoughtMetadataExtraction;
	precomputedTemporalMentions?: ExtractedTemporalMention[];
	ingestTimer?: IngestPhaseTimer;
	/** When true, relation extraction runs fire-and-forget after core enrich (background capture). */
	deferRelations?: boolean;
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
 * Throws when a required parallel step fails or enriched_at cannot be persisted,
 * so queue workers surface the real dependency error (AGE, LLM, schema) instead of
 * a generic "finished without enriched_at" message.
 */
export async function enrichThought(
	userId: string,
	thoughtId: string,
	normalizedText: string,
	options?: EnrichThoughtOptions
): Promise<void> {
	const {
		onProgress,
		thoughtEmbedding,
		thoughtCountAfterInsert,
		preloadedKnownEntities,
		precomputedEntityGraph,
		precomputedMetadata,
		precomputedTemporalMentions,
		ingestTimer,
		deferRelations = false
	} = options ?? {};
	const db = getDb();
	const time =
		ingestTimer?.time.bind(ingestTimer) ??
		(async <T>(_phase: IngestPhase, fn: () => Promise<T>) => fn());

	// Bump enrichment version — wrapped in try/catch so a missing column
	// (e.g. migration not yet applied) does not silently block all enrichment steps.
	try {
		await time('enrich_bump_version', () =>
			db
				.update(thought)
				.set({ enrichmentVersion: sql`${thought.enrichmentVersion} + 1` })
				.where(eq(thought.id, thoughtId))
		);
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
		phases: ['entities', 'temporal', 'memory_type', 'cues']
	});

	let projectLikeEntities: Array<{ entityId: string; label: string }> = [];
	const [entitiesResult, metadataResult, temporalResult] = await Promise.allSettled([
		time('enrich_entities', async () => {
			const entitySync = await syncEntityGraphFromThought({
				userId,
				thoughtId,
				normalizedText,
				preloadedKnownEntities,
				precomputedEntityGraph
			});
			projectLikeEntities = entitySync.projectLikeEntities;
			if (entitySync.mentionCount === 0 && shouldRetryEntityMentionExtraction(normalizedText)) {
				throw new Error(
					`entity graph sync produced zero mentions (${normalizedText.trim().length} chars)`
				);
			}
		}),

		time('enrich_metadata', async () => {
			const { memoryType, cues } =
				precomputedMetadata ?? (await extractThoughtMetadata({ userId, normalizedText }));
			await db
				.update(thought)
				.set({
					memoryType,
					...(cues.length > 0 ? { cues } : {})
				})
				.where(eq(thought.id, thoughtId));
		}),

		(async () => {
			const [thoughtRow] = await db
				.select({ createdAt: thought.createdAt })
				.from(thought)
				.where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))
				.limit(1);
			const capturedAt = thoughtRow?.createdAt ?? new Date();

			if (precomputedTemporalMentions !== undefined) {
				const timezone = await getUserPreferredTimezone(userId);
				return time('enrich_temporal', () =>
					syncTemporalEventsFromThought({
						userId,
						thoughtId,
						normalizedText,
						thoughtEmbedding,
						capturedAt,
						timezone,
						precomputedMentions: precomputedTemporalMentions
					})
				);
			}

			// Temporal graph sync reads entity_resolution_log when extracting inline — defer until after entities.
			return undefined;
		})()
	]);

	let temporalFollowUp: PromiseSettledResult<void> | undefined;
	if (precomputedTemporalMentions === undefined) {
		const [thoughtRow] = await db
			.select({ createdAt: thought.createdAt })
			.from(thought)
			.where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))
			.limit(1);
		const capturedAt = thoughtRow?.createdAt ?? new Date();
		const timezone = await getUserPreferredTimezone(userId);

		temporalFollowUp = await Promise.allSettled([
			time('enrich_temporal', () =>
				syncTemporalEventsFromThought({
					userId,
					thoughtId,
					normalizedText,
					thoughtEmbedding,
					capturedAt,
					timezone
				})
			)
		]).then((r) => r[0]);
	}

	// Log failures individually so one bad step doesn't hide others.
	const stepNames = ['entities', 'temporal', 'metadata'] as const;
	const temporalStepResult: PromiseSettledResult<void> =
		precomputedTemporalMentions !== undefined
			? temporalResult
			: (temporalFollowUp ?? { status: 'fulfilled', value: undefined });
	const results: PromiseSettledResult<void>[] = [
		entitiesResult,
		temporalStepResult,
		metadataResult
	];
	let allOk = true;

	for (let i = 0; i < results.length; i++) {
		const r = results[i]!;
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
			await time('ontology_eval', () =>
				maybeRefreshUserOntology({
					userId,
					thoughtCountAfterInsert,
					onBeforeEval: async () => { await onProgress?.({ parallel: false, phase: 'ontology_eval' }); }
				})
			);
		} catch (err) {
			console.error('[enrich] ontology refresh failed', {
				thoughtId,
				message: err instanceof Error ? err.message : String(err)
			});
		}

		try {
			await maybeNotifyGroundingQuestionPush(userId, thoughtCountAfterInsert);
		} catch (err) {
			console.error('[enrich] grounding question notify failed', {
				thoughtId,
				message: err instanceof Error ? err.message : String(err)
			});
		}
	}

	// ---- Mark enriched -------------------------------------------------------
	if (allOk) {
		try {
			await time('materialize_links', () =>
				materializeRetrievalLinksForThought({
					userId,
					thoughtId,
					normalizedText
				})
			);
		} catch (err) {
			console.error('[enrich] retrieval link materialization failed', {
				thoughtId,
				message: err instanceof Error ? err.message : String(err)
			});
		}

		try {
			const [thoughtRow] = await db
				.select({
					memoryType: thought.memoryType,
					category: thought.category
				})
				.from(thought)
				.where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))
				.limit(1);
			if (thoughtRow) {
				const graphHubHints = projectLikeEntities;
				await time('enrich_gtd_assignment', () =>
					applyGtdAssignment({
						userId,
						thoughtId,
						normalizedText,
						memoryType: thoughtRow.memoryType,
						category: thoughtRow.category,
						graphHubHints
					})
				);
			}
		} catch (err) {
			console.error('[enrich] GTD project assignment failed', {
				thoughtId,
				message: err instanceof Error ? err.message : String(err)
			});
		}

		if (projectLikeEntities.length > 0) {
			try {
				const projectProfileCount = await countGtdProjectProfilesForUser(userId);
				if (projectProfileCount >= 2) {
					await time('reconcile_projects', () => reconcileUserProjects(userId));
				}
			} catch (err) {
				console.error('[enrich] project reconciliation failed', {
					thoughtId,
					message: err instanceof Error ? err.message : String(err)
				});
			}
		}

		try {
			await time('mark_enriched', () =>
				db
					.update(thought)
					.set({ enrichedAt: new Date() })
					.where(eq(thought.id, thoughtId))
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.warn('[enrich] enriched_at write failed (migration pending?)', {
				thoughtId,
				message
			});
			throw new Error(`Failed to persist enriched_at: ${message}`, { cause: err });
		}

		scheduleIncrementalConsolidation(userId, thoughtId);
	} else {
		throw new Error(
			`Enrichment step(s) failed: ${formatEnrichStepFailures(results, stepNames).join('; ')}`
		);
	}

	if (deferRelations) {
		scheduleRelationEnrichment(userId, thoughtId, normalizedText, thoughtEmbedding);
		return;
	}

	await onProgress?.({ parallel: false, phase: 'relations' });
	try {
		await time('enrich_relations', () =>
			syncThoughtRelations({ userId, thoughtId, normalizedText, thoughtEmbedding, ingestTimer })
		);
	} catch (err) {
		console.error('[enrich] relation extraction failed', {
			thoughtId,
			message: err instanceof Error ? err.message : String(err)
		});
	}
}

async function syncThoughtRelations(input: {
	userId: string;
	thoughtId: string;
	normalizedText: string;
	thoughtEmbedding?: number[];
	ingestTimer?: IngestPhaseTimer;
}): Promise<void> {
	const db = getDb();
	const time =
		input.ingestTimer?.time.bind(input.ingestTimer) ??
		(async <T>(_phase: IngestPhase, fn: () => Promise<T>) => fn());

	await deleteThoughtOutgoingRelatesToEdges({ userId: input.userId, thoughtId: input.thoughtId });
	const relations = await time('relations_extract', () =>
		extractRelations({
			userId: input.userId,
			thoughtId: input.thoughtId,
			normalizedText: input.normalizedText,
			embedding: input.thoughtEmbedding
		})
	);
	await time('relations_persist', async () => {
		await db.transaction(async (tx) => {
			await tx
				.delete(thoughtRelation)
				.where(eq(thoughtRelation.sourceThoughtId, input.thoughtId));
			if (relations.length > 0) {
				await tx.insert(thoughtRelation).values(
					relations.map((r) => ({
						userId: input.userId,
						sourceThoughtId: input.thoughtId,
						targetThoughtId: r.targetId,
						relationType: r.relationType
					}))
				);
			}
		});
		for (const r of relations) {
			await upsertThoughtRelation({
				userId: input.userId,
				sourceId: input.thoughtId,
				targetId: r.targetId,
				relationType: r.relationType
			});
		}
		await syncThoughtNeighborLinks(input.userId, input.thoughtId);
	});
}

/** Fire-and-forget relation extraction after core enrich (avoids rerank LLM on capture hot path). */
export function scheduleRelationEnrichment(
	userId: string,
	thoughtId: string,
	normalizedText: string,
	thoughtEmbedding?: number[]
): void {
	void withDbUser(userId, () =>
		syncThoughtRelations({ userId, thoughtId, normalizedText, thoughtEmbedding })
	).catch((err) => {
		console.error('[enrich] scheduled relation extraction failed', {
			thoughtId,
			userId,
			message: err instanceof Error ? err.message : String(err)
		});
	});
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

function formatEnrichStepFailures(
	results: PromiseSettledResult<void>[],
	stepNames: readonly string[]
): string[] {
	const failures: string[] = [];
	for (let i = 0; i < results.length; i++) {
		const r = results[i]!;
		if (r.status === 'rejected') {
			const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
			failures.push(`${stepNames[i]}: ${reason}`);
		}
	}
	return failures;
}
