import { and, desc, eq, isNotNull, lt, or, sql } from 'drizzle-orm';
import type { CaptureIngestPhase } from '$lib/capture/ingest-phases';
import { captureSession, thought, thoughtRelation } from '$lib/server/db/schema';
import { getDb } from '$lib/server/db';
import { computeLexicalText } from '$lib/server/memory/lexical-text';
import {
	deleteThoughtOutgoingGraphEdges,
	deleteThoughtVertexFromGraph,
	upsertThoughtNode,
	upsertThoughtRelation
} from '$lib/server/graph/age';
import { createThoughtEmbedding } from '$lib/server/llm/embedding';
import { extractRelations } from '$lib/server/memory/relation-extraction';
import { loadIngestKnownEntityHints } from '$lib/server/memory/entity-graph-hints';
import { syncEntityGraphFromThought } from '$lib/server/memory/entity-graph-sync';
import { maybeRefreshUserOntology, resolveThoughtCategory } from '$lib/server/ontology';
import { ensureUserOntologySeeded } from '$lib/server/ontology-db';
import { applyThoughtEditRequest } from '$lib/server/capture/apply-thought-edit';
import { enrichThought, reenrichThought } from '$lib/server/capture/enrich';
import { assertCapturePipelineAffordable } from '$lib/server/billing/usage-gate';
import { decryptTenantValue, encryptTenantValue } from '$lib/server/crypto/tenant-encryption';

/** Deterministic text shaping only; kind key + FK come from `resolveThoughtCategory`. */
export function normalizeThoughtText(raw: string): { normalized: string; metadata: Record<string, unknown> } {
	const normalized = raw.trim().replace(/\s+/g, ' ');
	return {
		normalized,
		metadata: { pipeline: 'ontology_llm_v1' }
	};
}

function toPgVectorLiteral(values: number[]): string {
	return `[${values.join(',')}]`;
}

/** A single sequential phase or a parallel group of phases running concurrently. */
export type CaptureProgressEvent =
	| { parallel: false; phase: CaptureIngestPhase }
	| { parallel: true; phases: CaptureIngestPhase[] };

async function emitProgress(
	onProgress: ((event: CaptureProgressEvent) => Promise<void>) | undefined,
	phase: CaptureIngestPhase
) {
	await onProgress?.({ parallel: false, phase });
}

export type CaptureThoughtOptions = {
	onProgress?: (event: CaptureProgressEvent) => Promise<void>;
};

async function decryptThoughtRow<T extends {
	rawText: string;
	rawTextEncrypted?: string | null;
	normalizedText: string;
	normalizedTextEncrypted?: string | null;
	metadata: Record<string, unknown>;
	metadataEncrypted?: string | null;
}>(userId: string, row: T): Promise<T> {
	const [rawText, normalizedText, metadataJson] = await Promise.all([
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
			: Promise.resolve(row.normalizedText),
		row.metadataEncrypted
			? decryptTenantValue({
					userId,
					table: 'thought',
					column: 'metadata',
					ciphertext: row.metadataEncrypted
				})
			: Promise.resolve(JSON.stringify(row.metadata ?? {}))
	]);
	return {
		...row,
		rawText,
		normalizedText,
		metadata: JSON.parse(metadataJson) as Record<string, unknown>
	};
}

/**
 * Fast path: classify → embed → persist → AGE graph provenance anchor → return immediately.
 *
 * Heavy enrichment (relation extraction, entity graph sync, memory type
 * classification, cue extraction, ontology eval) runs via `enrichThought`
 * and is awaited before this function returns so the graph is populated eagerly.
 *
 * When the caller provides an `onProgress` callback (NDJSON streaming mode),
 * enrichment phase events are emitted on the open connection.
 */
export async function captureThought(userId: string, rawInput: string, options?: CaptureThoughtOptions) {
	const onProgress = options?.onProgress;
	await ensureUserOntologySeeded(getDb(), userId);
	await emitProgress(onProgress, 'accounting');
	await assertCapturePipelineAffordable(userId);
	const { normalized, metadata: baseMeta } = normalizeThoughtText(rawInput);

	// Classify and embed sequentially — both hit the same per-user rate-limited
	// LLM queue, so running them in parallel just makes one wait behind the other
	// with no throughput gain. Sequential lets us show the user two distinct steps.
	await emitProgress(onProgress, 'ontology');
	const ingestKnownEntities = await loadIngestKnownEntityHints({ userId, normalizedText: normalized });
	const categoryResult = await resolveThoughtCategory({
		userId,
		normalized,
		rawText: rawInput,
		knownEntities: ingestKnownEntities.length > 0 ? ingestKnownEntities : undefined
	});
	const { key: category, ontologyEntityKindId, confidence: categoryConfidence, alternatives: categoryAlternatives } = categoryResult;
	const metadata = {
		...baseMeta,
		categorySource: 'llm',
		categoryConfidence,
		categoryAlternatives,
		...(ingestKnownEntities.length > 0
			? { ingestKnownEntityCount: ingestKnownEntities.length }
			: {})
	};

	await emitProgress(onProgress, 'embedding');
	const embedding = await createThoughtEmbedding(userId, normalized);

	// captureSession + dedup check in parallel — session needs category (just resolved),
	// dedup needs embedding (just resolved). Both are DB-only, no LLM.
	await emitProgress(onProgress, 'session');
	const lexicalText = computeLexicalText(normalized);
	const vectorLiteral = toPgVectorLiteral(embedding);
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

	const [sessionRows, nearestRow] = await Promise.all([
		getDb()
			.insert(captureSession)
			.values({
				userId,
				status: 'accepted',
				rawInput,
				rawInputEncrypted,
				normalizedPreview: normalized,
				normalizedPreviewEncrypted,
				category,
				metadataPreview: { encrypted: true },
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
	const metadataEncrypted = await encryptTenantValue({
		userId,
		table: 'thought',
		column: 'metadata',
		plaintext: JSON.stringify({
			...metadata,
			...(nearDuplicateMeta ? { nearDuplicate: nearDuplicateMeta } : {})
		})
	});

	await emitProgress(onProgress, 'persist');
	const [stored] = await getDb().transaction(async (tx) => {
		const [t] = await tx
			.insert(thought)
			.values({
				userId,
				rawText: rawInput,
				rawTextEncrypted,
				normalizedText: normalized,
				normalizedTextEncrypted,
				lexicalText,
				category,
				ontologyEntityKindId,
				metadata: { encrypted: true, captureSessionId: sessionRow.id },
				metadataEncrypted,
				embedding: sql`${toPgVectorLiteral(embedding)}::vector`
			})
			.returning({
				id: thought.id,
				userId: thought.userId,
				rawText: thought.rawText,
				rawTextEncrypted: thought.rawTextEncrypted,
				normalizedText: thought.normalizedText,
				normalizedTextEncrypted: thought.normalizedTextEncrypted,
				lexicalText: thought.lexicalText,
				category: thought.category,
				metadata: thought.metadata,
				metadataEncrypted: thought.metadataEncrypted
			});
		return [t];
	});
	const decryptedStored = await decryptThoughtRow(userId, stored);

	// Fast path: sync the AGE graph node (lightweight, no LLM calls).
	await emitProgress(onProgress, 'graph');
	await upsertThoughtNode({
		id: stored.id,
		userId,
		category: stored.category
	});

	// Count thoughts for optional ontology eval trigger.
	const [countRow] = await getDb()
		.select({ n: sql<number>`count(*)::int` })
		.from(thought)
		.where(eq(thought.userId, userId));
	const thoughtCountAfterInsert = Number(countRow?.n ?? 0);

	const enrichOptions = {
		onProgress,
		thoughtEmbedding: embedding,
		thoughtCountAfterInsert,
		preloadedKnownEntities:
			ingestKnownEntities.length > 0 ? ingestKnownEntities : undefined
	};

	// Background enrichment: persist response returns immediately; graph enrichment may lag.
	void enrichThought(userId, stored.id, stored.normalizedText, enrichOptions);

	return decryptedStored;
}

export type EditStoredThoughtOptions = {
	onProgress?: (event: CaptureProgressEvent) => Promise<void>;
};

export async function editStoredThought(
	userId: string,
	thoughtId: string,
	editRequest: string,
	options?: EditStoredThoughtOptions
) {
	const onProgress = options?.onProgress;
	await ensureUserOntologySeeded(getDb(), userId);
	await emitProgress(onProgress, 'accounting');

	const [existing] = await getDb()
		.select()
		.from(thought)
		.where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))
		.limit(1);

	if (!existing) {
		return { ok: false as const, reason: 'not_found' as const };
	}

	const decryptedExisting = await decryptThoughtRow(userId, existing);
	const applied = await applyThoughtEditRequest({
		userId,
		existingRawText: decryptedExisting.rawText,
		existingNormalizedText: decryptedExisting.normalizedText,
		category: decryptedExisting.category,
		editRequest
	});

	const priorMeta = (decryptedExisting.metadata as Record<string, unknown>) ?? {};
	const editedRaw = applied.rawText;
	const textChanged = editedRaw !== decryptedExisting.rawText;
	const priorStatus = typeof priorMeta.status === 'string' ? priorMeta.status : 'open';
	const nextStatus = applied.status ?? priorStatus;

	const metadataPatch: Record<string, unknown> = {
		...priorMeta,
		lastEditRequest: editRequest.trim(),
		lastEditSummary: applied.summary,
		status: nextStatus,
		...(nextStatus === 'completed' ? { completedAt: new Date().toISOString() } : {})
	};

	if (!textChanged) {
		await emitProgress(onProgress, 'persist');
		const [updated] = await getDb()
			.update(thought)
			.set({
				metadata: metadataPatch,
				metadataEncrypted: await encryptTenantValue({
					userId,
					table: 'thought',
					column: 'metadata',
					plaintext: JSON.stringify(metadataPatch)
				}),
				updatedAt: new Date()
			})
			.where(eq(thought.id, thoughtId))
			.returning({
				id: thought.id,
				userId: thought.userId,
				rawText: thought.rawText,
				rawTextEncrypted: thought.rawTextEncrypted,
				normalizedText: thought.normalizedText,
				normalizedTextEncrypted: thought.normalizedTextEncrypted,
				lexicalText: thought.lexicalText,
				category: thought.category,
				metadata: thought.metadata,
				metadataEncrypted: thought.metadataEncrypted
			});

		await emitProgress(onProgress, 'graph');
		await upsertThoughtNode({
			id: updated!.id,
			userId,
			category: updated!.category
		});

		return {
			ok: true as const,
			thought: await decryptThoughtRow(userId, updated!),
			editSummary: applied.summary
		};
	}

	const { normalized, metadata: baseMeta } = normalizeThoughtText(editedRaw);
	await emitProgress(onProgress, 'ontology');
	const { key: category, ontologyEntityKindId, confidence: categoryConfidence, alternatives: categoryAlternatives } =
		await resolveThoughtCategory({
			userId,
			normalized,
			rawText: editedRaw
		});
	const metadata = {
		...metadataPatch,
		...baseMeta,
		categorySource: 'llm',
		categoryConfidence,
		categoryAlternatives
	};
	const lexicalText = computeLexicalText(normalized);
	await emitProgress(onProgress, 'embedding');
	const embedding = await createThoughtEmbedding(userId, normalized);
	const [rawTextEncrypted, normalizedTextEncrypted, metadataEncrypted] = await Promise.all([
		encryptTenantValue({ userId, table: 'thought', column: 'raw_text', plaintext: editedRaw }),
		encryptTenantValue({ userId, table: 'thought', column: 'normalized_text', plaintext: normalized }),
		encryptTenantValue({
			userId,
			table: 'thought',
			column: 'metadata',
			plaintext: JSON.stringify(metadata)
		})
	]);

	await emitProgress(onProgress, 'persist');
	const [updated] = await getDb()
		.update(thought)
		.set({
			rawText: editedRaw,
			rawTextEncrypted,
			normalizedText: normalized,
			normalizedTextEncrypted,
			lexicalText,
			embedding: sql`${toPgVectorLiteral(embedding)}::vector`,
			category,
			ontologyEntityKindId,
			enrichedAt: null,
			metadata,
			metadataEncrypted,
			updatedAt: new Date()
		})
		.where(eq(thought.id, thoughtId))
		.returning({
			id: thought.id,
			userId: thought.userId,
			rawText: thought.rawText,
			rawTextEncrypted: thought.rawTextEncrypted,
			normalizedText: thought.normalizedText,
			normalizedTextEncrypted: thought.normalizedTextEncrypted,
			lexicalText: thought.lexicalText,
			category: thought.category,
			metadata: thought.metadata,
			metadataEncrypted: thought.metadataEncrypted
		});
	const decryptedUpdated = await decryptThoughtRow(userId, updated!);

	await emitProgress(onProgress, 'graph');
	await upsertThoughtNode({
		id: updated!.id,
		userId,
		category: updated!.category
	});

	if (onProgress) {
		await reenrichThought(userId, decryptedUpdated.id, decryptedUpdated.normalizedText, {
			onProgress,
			thoughtEmbedding: embedding
		});
	} else {
		void reenrichThought(userId, decryptedUpdated.id, decryptedUpdated.normalizedText, {
			thoughtEmbedding: embedding
		});
	}

	return { ok: true as const, thought: decryptedUpdated, editSummary: applied.summary };
}

export type RelinkThoughtGraphOptions = {
	onProgress?: (event: CaptureProgressEvent) => Promise<void>;
};

/**
 * Re-runs relation + entity graph sync for an existing thought without changing
 * stored text. Clears outgoing AGE graph edges first so removed links don't linger.
 */
export async function relinkThoughtGraph(
	userId: string,
	thoughtId: string,
	options?: RelinkThoughtGraphOptions
) {
	const onProgress = options?.onProgress;
	await ensureUserOntologySeeded(getDb(), userId);
	await emitProgress(onProgress, 'accounting');

	const [existing] = await getDb()
		.select()
		.from(thought)
		.where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))
		.limit(1);

	if (!existing) {
		return { ok: false as const, reason: 'not_found' as const };
	}

	const decryptedExisting = await decryptThoughtRow(userId, existing);

	// Sync the node first (fast, no LLM).
	await emitProgress(onProgress, 'graph');
	await upsertThoughtNode({
		id: existing.id,
		userId,
		category: existing.category
	});

	if (onProgress) {
		await reenrichThought(userId, decryptedExisting.id, decryptedExisting.normalizedText, { onProgress });
	} else {
		void reenrichThought(userId, decryptedExisting.id, decryptedExisting.normalizedText);
	}

	return {
		ok: true as const,
		thought: {
			id: decryptedExisting.id,
			userId: decryptedExisting.userId,
			rawText: decryptedExisting.rawText,
			normalizedText: decryptedExisting.normalizedText,
			lexicalText: decryptedExisting.lexicalText,
			category: decryptedExisting.category,
			metadata: decryptedExisting.metadata as Record<string, unknown>
		}
	};
}

/**
 * Removes a thought from the AGE graph first (so a failed DB step can be repaired with relink),
 * then deletes the Postgres row (cascades `thought_relation` and `entity_resolution_log`).
 */
export async function deleteThoughtForUser(userId: string, thoughtId: string) {
	await ensureUserOntologySeeded(getDb(), userId);

	const [existing] = await getDb()
		.select({ id: thought.id })
		.from(thought)
		.where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))
		.limit(1);

	if (!existing) {
		return { ok: false as const, reason: 'not_found' as const };
	}

	await deleteThoughtVertexFromGraph({ userId, thoughtId: existing.id });

	await getDb().delete(thought).where(and(eq(thought.id, existing.id), eq(thought.userId, userId)));

	return { ok: true as const };
}

async function decryptThoughtSnippetRow<
	T extends {
		normalizedText: string;
		normalizedTextEncrypted?: string | null;
	}
>(userId: string, row: T): Promise<T> {
	const normalizedText = row.normalizedTextEncrypted
		? await decryptTenantValue({
				userId,
				table: 'thought',
				column: 'normalized_text',
				ciphertext: row.normalizedTextEncrypted
			})
		: row.normalizedText;
	return { ...row, normalizedText };
}

export async function listThoughts(
	userId: string,
	options?: {
		limit?: number;
		fields?: 'snippet' | 'full';
		cursor?: { createdAt: Date; id: string };
	}
) {
	const limit = Math.max(1, Math.min(options?.limit ?? 20, 100));
	const fields = options?.fields ?? 'full';
	const cursor = options?.cursor;

	if (fields === 'snippet') {
		const rows = await getDb()
			.select({
				id: thought.id,
				normalizedText: thought.normalizedText,
				normalizedTextEncrypted: thought.normalizedTextEncrypted,
				category: thought.category,
				memoryType: thought.memoryType,
				createdAt: thought.createdAt
			})
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
		return Promise.all(rows.map((row) => decryptThoughtSnippetRow(userId, row)));
	}

	const rows = await getDb()
		.select({
			id: thought.id,
			userId: thought.userId,
			rawText: thought.rawText,
			rawTextEncrypted: thought.rawTextEncrypted,
			normalizedText: thought.normalizedText,
			normalizedTextEncrypted: thought.normalizedTextEncrypted,
			category: thought.category,
			metadata: thought.metadata,
			metadataEncrypted: thought.metadataEncrypted,
			memoryType: thought.memoryType,
			createdAt: thought.createdAt,
			updatedAt: thought.updatedAt
		})
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
	return Promise.all(rows.map((row) => decryptThoughtRow(userId, row)));
}
