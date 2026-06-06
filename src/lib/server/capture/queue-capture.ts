/**
 * Tier 1 hot path: persist full text + lexical_text only, return immediately. Row is the queue.
 * Tier 2 (background enrich) and tier 3 (overnight consolidation) add vectors, links, and
 * community artifacts on the same row — see docs/planning/ingest-retrieval-timing.md.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import { captureSession, thought, type CaptureSource, type EnrichQueueStatus } from '$lib/server/db/schema';
import { getDb } from '$lib/server/db';
import { computeLexicalText } from '$lib/server/memory/lexical-text';
import { upsertThoughtNode } from '$lib/server/graph/age';
import { ensureUserOntologySeeded, loadOntologyForUser } from '$lib/server/ontology-db';
import { encryptTenantValue } from '$lib/server/crypto/tenant-encryption';
import { assertCapturePipelineAffordable } from '$lib/server/billing/usage-gate';
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
	await assertCapturePipelineAffordable(userId);
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
			captureSource: source
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
