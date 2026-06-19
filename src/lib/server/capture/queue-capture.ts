/**
 * Tier 1 hot path: persist full text + lexical_text only, return immediately. Row is the queue.
 * Tier 2 (background enrich) and tier 3 (overnight consolidation) add vectors, links, and
 * community artifacts on the same row — see docs/planning/ingest-retrieval-timing.md.
 */
import { and, asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { captureSession, thought, type CaptureSource, type EnrichQueueStatus } from '$lib/server/db/schema';
import { getDb } from '$lib/server/db';
import { computeLexicalText } from '$lib/server/memory/lexical-text';
import { upsertThoughtNode } from '$lib/server/graph/age';
import { ensureUserOntologySeeded, loadOntologyForUser } from '$lib/server/ontology-db';
import { encryptTenantValue } from '$lib/server/crypto/tenant-encryption';
import { assertCaptureAllowed } from '$lib/server/onboarding/capture-gate';
import { normalizeThoughtText } from '$lib/server/capture/service';
import { scheduleCaptureEnrichWorker } from '$lib/server/capture/capture-enrich-worker';

/** Placeholder category until background worker classifies. */
export const QUEUE_PLACEHOLDER_CATEGORY = 'observation';

export type QueueCaptureResult = {
	thoughtId: string;
	status: 'queued';
	normalizedText: string;
};

export type QueueCaptureOptions = {
	source?: CaptureSource;
	/** When true, skip scheduling background worker (eval inline enrich). */
	skipWorker?: boolean;
	/** Override thought.createdAt (e.g. backdated haystack session date from external driver). */
	capturedAt?: Date;
};

async function resolvePlaceholderOntologyKindId(userId: string): Promise<string> {
	await ensureUserOntologySeeded(getDb(), userId);
	const loaded = await loadOntologyForUser(getDb(), userId);
	const kind = loaded.entityKindsByKey.get(QUEUE_PLACEHOLDER_CATEGORY);
	if (!kind) {
		throw new Error(
			`Queue capture requires placeholder category "${QUEUE_PLACEHOLDER_CATEGORY}" in user ontology`
		);
	}
	return kind.id;
}

/**
 * Insert one thought row (full text, no LLM). Returns immediately.
 */
export async function queueCapture(
	userId: string,
	rawInput: string,
	options?: QueueCaptureOptions
): Promise<QueueCaptureResult> {
	await assertCaptureAllowed(userId);
	const { normalized, metadata } = normalizeThoughtText(rawInput);
	const lexicalText = computeLexicalText(normalized);
	const ontologyEntityKindId = await resolvePlaceholderOntologyKindId(userId);
	const source = options?.source ?? 'api';

	const [rawInputEncrypted, normalizedPreviewEncrypted, rawTextEncrypted, normalizedTextEncrypted] =
		await Promise.all([
			encryptTenantValue({ userId, table: 'capture_session', column: 'raw_input', plaintext: rawInput }),
			encryptTenantValue({
				userId,
				table: 'capture_session',
				column: 'normalized_preview',
				plaintext: normalized
			}),
			encryptTenantValue({ userId, table: 'thought', column: 'raw_text', plaintext: rawInput }),
			encryptTenantValue({ userId, table: 'thought', column: 'normalized_text', plaintext: normalized })
		]);

	const metadataEncrypted = await encryptTenantValue({
		userId,
		table: 'thought',
		column: 'metadata',
		plaintext: JSON.stringify({ ...metadata, queueTier: 'pending_enrich' })
	});

	const db = getDb();
	const [sessionRow] = await db
		.insert(captureSession)
		.values({
			userId,
			status: 'accepted',
			rawInput,
			rawInputEncrypted,
			normalizedPreview: normalized,
			normalizedPreviewEncrypted,
			category: QUEUE_PLACEHOLDER_CATEGORY,
			metadataPreview: { encrypted: true },
			revisionCount: 0
		})
		.returning({ id: captureSession.id });

	const capturedAt = options?.capturedAt;
	const [stored] = await db
		.insert(thought)
		.values({
			userId,
			rawText: rawInput,
			rawTextEncrypted,
			normalizedText: normalized,
			normalizedTextEncrypted,
			lexicalText,
			category: QUEUE_PLACEHOLDER_CATEGORY,
			ontologyEntityKindId,
			metadata: { encrypted: true, captureSessionId: sessionRow.id, queueTier: 'pending_enrich' },
			metadataEncrypted,
			enrichQueueStatus: 'pending',
			captureSource: source,
			...(capturedAt ? { createdAt: capturedAt, updatedAt: capturedAt } : {})
		})
		.returning({ id: thought.id });

	await upsertThoughtNode({
		id: stored.id,
		userId,
		category: QUEUE_PLACEHOLDER_CATEGORY
	});

	if (!options?.skipWorker) {
		scheduleCaptureEnrichWorker(userId);
	}

	return {
		thoughtId: stored.id,
		status: 'queued',
		normalizedText: normalized
	};
}

export type ClaimedQueuedThought = {
	id: string;
	rawText: string;
	normalizedText: string;
	rawTextEncrypted: string | null;
	normalizedTextEncrypted: string | null;
};

/**
 * Atomically claim the next pending row for this user (FIFO).
 */
export async function claimNextPendingThought(userId: string): Promise<ClaimedQueuedThought | null> {
	const db = getDb();
	const [next] = await db
		.select({
			id: thought.id,
			rawText: thought.rawText,
			normalizedText: thought.normalizedText,
			rawTextEncrypted: thought.rawTextEncrypted,
			normalizedTextEncrypted: thought.normalizedTextEncrypted
		})
		.from(thought)
		.where(and(eq(thought.userId, userId), eq(thought.enrichQueueStatus, 'pending')))
		.orderBy(asc(thought.createdAt), asc(thought.id))
		.limit(1);

	if (!next) return null;

	const [claimed] = await db
		.update(thought)
		.set({ enrichQueueStatus: 'processing' satisfies EnrichQueueStatus })
		.where(and(eq(thought.id, next.id), eq(thought.enrichQueueStatus, 'pending')))
		.returning({
			id: thought.id,
			rawText: thought.rawText,
			normalizedText: thought.normalizedText,
			rawTextEncrypted: thought.rawTextEncrypted,
			normalizedTextEncrypted: thought.normalizedTextEncrypted
		});

	return claimed ?? null;
}

export async function markEnrichQueueComplete(thoughtId: string): Promise<void> {
	await getDb()
		.update(thought)
		.set({
			enrichQueueStatus: 'complete' satisfies EnrichQueueStatus,
			enrichQueueError: null
		})
		.where(eq(thought.id, thoughtId));
}

export async function markEnrichQueueFailed(thoughtId: string, error: string): Promise<void> {
	await getDb()
		.update(thought)
		.set({
			enrichQueueStatus: 'failed' satisfies EnrichQueueStatus,
			enrichQueueError: error.slice(0, 2000)
		})
		.where(eq(thought.id, thoughtId));
}

export async function countPendingEnrichRows(userId: string): Promise<number> {
	const db = getDb();
	const [row] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(thought)
		.where(and(eq(thought.userId, userId), eq(thought.enrichQueueStatus, 'pending')));
	return Number(row?.n ?? 0);
}

/** Default age before a stuck `processing` row is requeued as `pending`. */
export const STALE_ENRICH_PROCESSING_MAX_AGE_MS = 10 * 60 * 1000;

const STALE_RECOVERY_NOTE = 'Enrichment interrupted before completion (stale processing recovery)';

/**
 * Reset enrich rows left in `processing` after a worker crash or hang.
 * Returns the number of rows requeued.
 */
export async function recoverStaleEnrichProcessingRows(
	userId: string,
	maxAgeMs: number = STALE_ENRICH_PROCESSING_MAX_AGE_MS
): Promise<number> {
	const cutoff = new Date(Date.now() - maxAgeMs);
	const db = getDb();
	const stale = await db
		.select({ id: thought.id })
		.from(thought)
		.where(
			and(
				eq(thought.userId, userId),
				eq(thought.enrichQueueStatus, 'processing'),
				lt(thought.updatedAt, cutoff)
			)
		);

	if (stale.length === 0) return 0;

	await db
		.update(thought)
		.set({
			enrichQueueStatus: 'pending' satisfies EnrichQueueStatus,
			enrichQueueError: STALE_RECOVERY_NOTE
		})
		.where(
			and(
				eq(thought.userId, userId),
				inArray(
					thought.id,
					stale.map((row) => row.id)
				)
			)
		);

	return stale.length;
}

/**
 * Re-queue rows marked complete without enriched_at (orphaned tier-2 state).
 * Returns the number of rows requeued.
 */
export async function requeueOrphanedCompleteEnrichRows(userId: string): Promise<number> {
	const db = getDb();
	const orphaned = await db
		.select({ id: thought.id })
		.from(thought)
		.where(
			and(
				eq(thought.userId, userId),
				eq(thought.enrichQueueStatus, 'complete' satisfies EnrichQueueStatus),
				isNull(thought.enrichedAt)
			)
		);

	if (orphaned.length === 0) return 0;

	await db
		.update(thought)
		.set({
			enrichQueueStatus: 'pending' satisfies EnrichQueueStatus,
			enrichQueueError: null
		})
		.where(
			and(
				eq(thought.userId, userId),
				inArray(
					thought.id,
					orphaned.map((row) => row.id)
				)
			)
		);

	return orphaned.length;
}

const RETRYABLE_ENRICH_STATUSES: EnrichQueueStatus[] = ['pending', 'processing', 'failed'];

/** Re-queue one thought for background enrich (user-initiated retry). */
export async function requeueEnrichThought(
	userId: string,
	thoughtId: string
): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'not_retryable' }> {
	const db = getDb();
	const [existing] = await db
		.select({
			id: thought.id,
			enrichQueueStatus: thought.enrichQueueStatus,
			enrichedAt: thought.enrichedAt
		})
		.from(thought)
		.where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))
		.limit(1);

	if (!existing) {
		return { ok: false, reason: 'not_found' };
	}

	const status = existing.enrichQueueStatus;
	const orphanedComplete = status === 'complete' && existing.enrichedAt == null;
	if (!orphanedComplete && (!status || !RETRYABLE_ENRICH_STATUSES.includes(status))) {
		return { ok: false, reason: 'not_retryable' };
	}

	await db
		.update(thought)
		.set({
			enrichQueueStatus: 'pending' satisfies EnrichQueueStatus,
			enrichQueueError: null
		})
		.where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)));

	scheduleCaptureEnrichWorker(userId);
	return { ok: true };
}
