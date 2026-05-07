import { and, eq } from 'drizzle-orm';
import { captureSession, thought, type ThoughtCategory } from '$lib/server/db/schema';
import { getDb } from '$lib/server/db';
import { logActivityCall } from '$lib/server/activity/log-call';
import { computeLexicalText } from '$lib/server/memory/lexical-text';
import { upsertThoughtNode } from '$lib/server/graph/falkor';
import { createThoughtEmbedding } from '$lib/server/llm/embedding';

/** Explicit MVP pricing unit until the LLM ingest path is wired. */
const CAPTURE_BASE_COST_USD = 0.0005;

export function deterministicNormalize(raw: string): {
	normalized: string;
	category: ThoughtCategory;
	metadata: Record<string, unknown>;
} {
	const normalized = raw.trim().replace(/\s+/g, ' ');
	let category: ThoughtCategory = 'thought';
	if (/\b(todo|task)\b/i.test(raw)) category = 'task';
	else if (/\bidea\b/i.test(raw)) category = 'idea';
	else if (/\b(reference|ref|link)\b/i.test(raw)) category = 'reference';
	return {
		normalized,
		category,
		metadata: { pipeline: 'deterministic_mvp' }
	};
}

async function logCaptureActivity(userId: string, operation: 'capture_submit' | 'capture_edit') {
	await logActivityCall(getDb(), userId, {
		provider: 'mvp_stub',
		operation,
		baseCostUsd: CAPTURE_BASE_COST_USD
	});
}

export async function captureThought(userId: string, rawInput: string) {
	await logCaptureActivity(userId, 'capture_submit');
	const { normalized, category, metadata } = deterministicNormalize(rawInput);

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

	const embedding = await createThoughtEmbedding(userId, normalized);

	const lexicalText = computeLexicalText(normalized);

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
				embedding
			})
			.returning();
		return [t];
	});

	await upsertThoughtNode({
		id: stored.id,
		userId,
		rawText: stored.rawText,
		normalizedText: stored.normalizedText,
		lexicalText: stored.lexicalText ?? lexicalText,
		category: stored.category
	});

	return stored;
}

export async function editStoredThought(
	userId: string,
	thoughtId: string,
	editRequest: string
) {
	await logCaptureActivity(userId, 'capture_edit');

	const [existing] = await getDb()
		.select()
		.from(thought)
		.where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))
		.limit(1);

	if (!existing) return { ok: false as const, reason: 'not_found' as const };

	// MVP deterministic "natural language edit": append instruction, then normalize.
	const editedRaw = `${existing.rawText}\n\nEdit request: ${editRequest.trim()}`;
	const { normalized, category, metadata } = deterministicNormalize(editedRaw);
	const lexicalText = computeLexicalText(normalized);
	const embedding = await createThoughtEmbedding(userId, normalized);

	const [updated] = await getDb()
		.update(thought)
		.set({
			rawText: editedRaw,
			normalizedText: normalized,
			lexicalText,
			embedding,
			category,
			metadata: {
				...(existing.metadata as Record<string, unknown>),
				...metadata,
				lastEditRequest: editRequest.trim()
			},
			updatedAt: new Date()
		})
		.where(eq(thought.id, thoughtId))
		.returning();

	await upsertThoughtNode({
		id: updated!.id,
		userId,
		rawText: updated!.rawText,
		normalizedText: updated!.normalizedText,
		lexicalText: updated!.lexicalText ?? lexicalText,
		category: updated!.category
	});

	return { ok: true as const, thought: updated! };
}
