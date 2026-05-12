import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import type { CaptureIngestPhase } from '$lib/capture/ingest-phases';
import { captureSession, thought, thoughtRelation } from '$lib/server/db/schema';
import { getDb } from '$lib/server/db';
import { logActivityCall } from '$lib/server/activity/log-call';
import { computeLexicalText } from '$lib/server/memory/lexical-text';
import { upsertThoughtNode, upsertThoughtRelation } from '$lib/server/graph/falkor';
import { createThoughtEmbedding } from '$lib/server/llm/embedding';
import { extractRelations } from '$lib/server/memory/relation-extraction';
import { syncEntityGraphFromThought } from '$lib/server/memory/entity-graph-sync';
import { maybeRefreshUserOntology, resolveThoughtCategory } from '$lib/server/ontology';
import { ensureUserOntologySeeded } from '$lib/server/ontology-db';

/** Explicit MVP pricing unit until the LLM ingest path is wired. */
const CAPTURE_BASE_COST_USD = 0.0005;

/** Deterministic text shaping only; category comes from `resolveThoughtCategory`. */
export function normalizeThoughtText(raw: string): { normalized: string; metadata: Record<string, unknown> } {
	const normalized = raw.trim().replace(/\s+/g, ' ');
	return {
		normalized,
		metadata: { pipeline: 'ontology_llm_v1' }
	};
}

async function logCaptureActivity(userId: string, operation: 'capture_submit' | 'capture_edit', durationMs?: number) {
	await logActivityCall(getDb(), userId, {
		provider: 'mvp_stub',
		operation,
		baseCostUsd: CAPTURE_BASE_COST_USD,
		durationMs
	});
}

async function syncThoughtRelations(input: {
	userId: string;
	thoughtId: string;
	normalizedText: string;
}) {
	const relations = await extractRelations({
		userId: input.userId,
		thoughtId: input.thoughtId,
		normalizedText: input.normalizedText
	});

	await getDb().transaction(async (tx) => {
		await tx.delete(thoughtRelation).where(eq(thoughtRelation.sourceThoughtId, input.thoughtId));
		if (relations.length > 0) {
			await tx.insert(thoughtRelation).values(
				relations.map((relation) => ({
					userId: input.userId,
					sourceThoughtId: input.thoughtId,
					targetThoughtId: relation.targetId,
					relationType: relation.relationType
				}))
			);
		}
	});

	for (const relation of relations) {
		await upsertThoughtRelation({
			userId: input.userId,
			sourceId: input.thoughtId,
			targetId: relation.targetId,
			relationType: relation.relationType
		});
	}
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

export async function captureThought(userId: string, rawInput: string, options?: CaptureThoughtOptions) {
	const captureStart = Date.now();
	const onProgress = options?.onProgress;
	await ensureUserOntologySeeded(getDb(), userId);
	emitProgress(onProgress, 'accounting');
	const { normalized, metadata: baseMeta } = normalizeThoughtText(rawInput);

	emitProgress(onProgress, 'ontology');
	const category = await resolveThoughtCategory({
		userId,
		normalized,
		rawText: rawInput
	});
	const metadata = { ...baseMeta, categorySource: 'llm' };

	emitProgress(onProgress, 'session');
	const [sessionRow] = await getDb()
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
		.returning();

	emitProgress(onProgress, 'embedding');
	const embedding = await createThoughtEmbedding(userId, normalized);

	const lexicalText = computeLexicalText(normalized);

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
				metadata: {
					...metadata,
					captureSessionId: sessionRow.id
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

	emitProgress(onProgress, 'graph');
	await upsertThoughtNode({
		id: stored.id,
		userId,
		rawText: stored.rawText,
		normalizedText: stored.normalizedText,
		lexicalText: stored.lexicalText,
		category: stored.category
	});

	emitProgress(onProgress, 'relations');
	await syncThoughtRelations({
		userId,
		thoughtId: stored.id,
		normalizedText: stored.normalizedText
	});

	emitProgress(onProgress, 'entities');
	await syncEntityGraphFromThought({
		userId,
		thoughtId: stored.id,
		normalizedText: stored.normalizedText
	});

	const [countRow] = await getDb()
		.select({ n: sql<number>`count(*)::int` })
		.from(thought)
		.where(eq(thought.userId, userId));
	const thoughtCountAfterInsert = Number(countRow?.n ?? 0);
	await maybeRefreshUserOntology({
		userId,
		thoughtCountAfterInsert,
		onBeforeEval: () => emitProgress(onProgress, 'ontology_eval')
	});

	await logCaptureActivity(userId, 'capture_submit', Date.now() - captureStart);

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

	// Treat edits as direct replacements for the stored thought text.
	const editedRaw = editRequest.trim();
	const { normalized, metadata: baseMeta } = normalizeThoughtText(editedRaw);
	emitProgress(onProgress, 'ontology');
	const category = await resolveThoughtCategory({
		userId,
		normalized,
		rawText: editedRaw
	});
	const metadata = { ...baseMeta, categorySource: 'llm' };
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

	emitProgress(onProgress, 'graph');
	await upsertThoughtNode({
		id: updated!.id,
		userId,
		rawText: updated!.rawText,
		normalizedText: updated!.normalizedText,
		lexicalText: updated!.lexicalText,
		category: updated!.category
	});

	emitProgress(onProgress, 'relations');
	await syncThoughtRelations({
		userId,
		thoughtId: updated!.id,
		normalizedText: updated!.normalizedText
	});

	emitProgress(onProgress, 'entities');
	await syncEntityGraphFromThought({
		userId,
		thoughtId: updated!.id,
		normalizedText: updated!.normalizedText
	});

	await logCaptureActivity(userId, 'capture_edit', Date.now() - editStart);

	return { ok: true as const, thought: updated! };
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
