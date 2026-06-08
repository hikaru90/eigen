/**
 * Tier 2: enrich a queued thought row in place using full user context.
 */
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { thought } from '$lib/server/db/schema';
import { createThoughtEmbedding } from '$lib/server/llm/embedding';
import { resolveThoughtCategory } from '$lib/server/ontology';
import { enrichThought, type EnrichThoughtOptions } from '$lib/server/capture/enrich';
import {
	loadEnrichmentContext,
	type EnrichmentContext
} from '$lib/server/capture/enrichment-context';
import { decryptTenantValue, encryptTenantValue } from '$lib/server/crypto/tenant-encryption';
import { toPgVectorLiteral } from '$lib/server/capture/service';
import { runIngestWithRetries } from '$lib/server/ingest/retry';
import type { CaptureProgressEvent } from '$lib/server/capture/service';
import {
	createIngestPhaseTimer,
	logIngestPhaseTiming,
	type IngestPhaseTimer
} from '$lib/server/capture/phase-timing';
import {
	extractEntityGraphBundle,
	type ExtractedEntityMention,
	type ExtractedEntityTriple
} from '$lib/server/memory/entity-extraction';
import { extractThoughtMetadata, type ThoughtMetadataExtraction } from '$lib/server/memory/extract-thought-metadata';
import { extractTemporalMentions } from '$lib/server/memory/temporal-extraction';
import { getUserPreferredTimezone } from '$lib/server/memory/user-timezone';
import {
	markEnrichQueueComplete,
	markEnrichQueueFailed
} from '$lib/server/capture/queue-capture';
import { drainCaptureEnrichQueue } from '$lib/server/capture/enrich-queue-drain';

export type EnrichQueuedThoughtOptions = {
	onProgress?: (event: CaptureProgressEvent) => Promise<void>;
	ingestTimer?: IngestPhaseTimer;
	/** Pre-loaded context (tests). */
	context?: EnrichmentContext;
};

async function decryptQueuedRow(
	userId: string,
	row: {
		rawText: string;
		normalizedText: string;
		rawTextEncrypted: string | null;
		normalizedTextEncrypted: string | null;
	}
): Promise<{ rawText: string; normalizedText: string }> {
	const [rawText, normalizedText] = await Promise.all([
		row.rawTextEncrypted
			? decryptTenantValue({
					userId,
					table: 'thought',
					column: 'raw_text',
					ciphertext: row.rawTextEncrypted
				})
			: Promise.resolve(row.rawText),
		row.normalizedTextEncrypted
			? decryptTenantValue({
					userId,
					table: 'thought',
					column: 'normalized_text',
					ciphertext: row.normalizedTextEncrypted
				})
			: Promise.resolve(row.normalizedText)
	]);
	return { rawText, normalizedText };
}

async function prefetchEnrichExtractions(input: {
	context: EnrichmentContext;
	capturedAt: Date;
}): Promise<{
	category: Awaited<ReturnType<typeof resolveThoughtCategory>>;
	embedding: number[];
	entityGraph: { mentions: ExtractedEntityMention[]; triples: ExtractedEntityTriple[] };
	metadata: ThoughtMetadataExtraction;
	temporalMentions: Awaited<ReturnType<typeof extractTemporalMentions>>;
}> {
	const { context, capturedAt } = input;
	const userId = context.userId;
	const { normalizedText, rawText, knownEntities } = context;

	const ontologyEntityKinds = context.ontology.entityKinds
		.filter((k) => k.active && k.kindType === 'entity_type')
		.map((k) => ({ key: k.key, name: k.name, definition: k.definition }));

	const knownEntityArg =
		knownEntities.length > 0
			? knownEntities.map((e) => ({ label: e.label, entityType: e.entityType }))
			: undefined;

	const anchorTimezone = await getUserPreferredTimezone(userId);

	const [category, embedding, entityGraph, metadata, temporalMentions] = await Promise.all([
		resolveThoughtCategory({
			userId,
			normalized: normalizedText,
			rawText,
			knownEntities: knownEntityArg,
			groundingProfile: context.groundingProfile
		}),
		createThoughtEmbedding(userId, normalizedText),
		ontologyEntityKinds.length > 0
			? extractEntityGraphBundle({
					userId,
					normalizedText,
					ontologyEntityKinds,
					knownEntities: knownEntityArg,
					groundingProfile: context.groundingProfile
				})
			: Promise.resolve({ mentions: [], triples: [] }),
		extractThoughtMetadata({
			userId,
			normalizedText,
			groundingProfile: context.groundingProfile
		}),
		extractTemporalMentions({
			userId,
			normalizedText,
			capturedAt,
			timezone: anchorTimezone
		})
	]);

	return { category, embedding, entityGraph, metadata, temporalMentions };
}

/**
 * Full enrich pipeline for one queued row: context → classify/embed → graph enrich.
 */
export async function enrichQueuedThought(
	userId: string,
	thoughtId: string,
	options?: EnrichQueuedThoughtOptions
): Promise<void> {
	const onProgress = options?.onProgress;
	const ingestTimer = options?.ingestTimer ?? createIngestPhaseTimer();
	const time = ingestTimer.time.bind(ingestTimer);

	try {
		await runIngestWithRetries(async () => {
			const db = getDb();
			const [row] = await db
				.select({
					id: thought.id,
					rawText: thought.rawText,
					normalizedText: thought.normalizedText,
					rawTextEncrypted: thought.rawTextEncrypted,
					normalizedTextEncrypted: thought.normalizedTextEncrypted,
					createdAt: thought.createdAt
				})
				.from(thought)
				.where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))
				.limit(1);

			if (!row) {
				throw new Error(`Queued thought not found: ${thoughtId}`);
			}

			const { rawText, normalizedText } = await decryptQueuedRow(userId, row);

			const context =
				options?.context ??
				(await time('load_enrichment_context', () =>
					loadEnrichmentContext({ userId, thoughtId, normalizedText, rawText })
				));

			await onProgress?.({ parallel: false, phase: 'ontology' });
			await onProgress?.({ parallel: false, phase: 'embedding' });

			const prefetched = await time('prefetch_enrich_llm', () =>
				prefetchEnrichExtractions({ context, capturedAt: row.createdAt })
			);

			const {
				key: category,
				ontologyEntityKindId,
				confidence: categoryConfidence,
				alternatives: categoryAlternatives
			} = prefetched.category;

			await time('persist_classify_embed', async () => {
				await db
					.update(thought)
					.set({
						category,
						ontologyEntityKindId,
						embedding: sql`${toPgVectorLiteral(prefetched.embedding)}::vector`,
						metadataEncrypted: await encryptMetadataPatch(userId, thoughtId, {
							categorySource: 'llm',
							categoryConfidence,
							categoryAlternatives,
							enrichmentContext: context.completeness
						})
					})
					.where(eq(thought.id, thoughtId));
			});

			const [countRow] = await db
				.select({ n: sql<number>`count(*)::int` })
				.from(thought)
				.where(eq(thought.userId, userId));
			const thoughtCountAfterInsert = Number(countRow?.n ?? 0);

			const enrichOpts: EnrichThoughtOptions = {
				onProgress,
				thoughtEmbedding: prefetched.embedding,
				thoughtCountAfterInsert,
				preloadedKnownEntities:
					context.knownEntities.length > 0
						? context.knownEntities.map((e) => ({ label: e.label, entityType: e.entityType }))
						: undefined,
				precomputedEntityGraph: prefetched.entityGraph,
				precomputedMetadata: prefetched.metadata,
				precomputedTemporalMentions: prefetched.temporalMentions,
				ingestTimer,
				deferRelations: false
			};

			await enrichThought(userId, thoughtId, normalizedText, enrichOpts);
		});

		await markEnrichQueueComplete(thoughtId);
		logIngestPhaseTiming({
			userId,
			thoughtId,
			timing: ingestTimer.finish()
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('[enrich-queued] failed', { userId, thoughtId, message });
		await markEnrichQueueFailed(thoughtId, message);
		throw err;
	}
}

async function encryptMetadataPatch(
	userId: string,
	thoughtId: string,
	patch: Record<string, unknown>
): Promise<string> {
	const db = getDb();
	const [existing] = await db
		.select({ metadata: thought.metadata, metadataEncrypted: thought.metadataEncrypted })
		.from(thought)
		.where(eq(thought.id, thoughtId))
		.limit(1);

	let base: Record<string, unknown> = {};
	if (existing?.metadataEncrypted) {
		const json = await decryptTenantValue({
			userId,
			table: 'thought',
			column: 'metadata',
			ciphertext: existing.metadataEncrypted
		});
		base = JSON.parse(json) as Record<string, unknown>;
	} else if (existing?.metadata && typeof existing.metadata === 'object') {
		base = { ...(existing.metadata as Record<string, unknown>) };
	}

	return encryptTenantValue({
		userId,
		table: 'thought',
		column: 'metadata',
		plaintext: JSON.stringify({ ...base, ...patch })
	});
}

/** Drain all pending rows for a user (eval / admin). */
export async function processCaptureEnrichQueue(
	userId: string,
	options?: { concurrency?: number }
): Promise<number> {
	return drainCaptureEnrichQueue(userId, options);
}
