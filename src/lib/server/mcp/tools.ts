import { and, eq } from 'drizzle-orm';
import {
	captureThought,
	deleteThoughtForUser,
	editStoredThought,
	listThoughts
} from '$lib/server/capture/service';
import { getDb } from '$lib/server/db';
import { thought } from '$lib/server/db/schema';
import { searchThoughts } from '$lib/server/retrieval/service';
import { composeAnswer } from '$lib/server/qa/compose-answer';
import { CONTEXT_WEIGHTS } from '$lib/server/retrieval';
import { tryRecordRetrievalQualityEvent } from '$lib/server/retrieval/quality-telemetry';
import { validateNonEmptyEntityId, validateSearchParams } from '$lib/server/validation/mcp-args';

export type McpToolContext = {
	userId: string;
};

function asObject(input: unknown): Record<string, unknown> {
	return input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
}

export async function runCaptureThoughtTool(context: McpToolContext, args: unknown) {
	const body = asObject(args);
	const raw = typeof body.raw === 'string' ? body.raw : '';
	if (!raw.trim()) {
		throw new Error('raw is required');
	}
	const stored = await captureThought(context.userId, raw);
	return { thoughtId: stored.id, thought: stored };
}

export async function runListThoughtsTool(context: McpToolContext, args: unknown) {
	const body = asObject(args);
	const limit = typeof body.limit === 'number' ? body.limit : 20;
	const cursorCreatedAt =
		typeof body.cursor_created_at === 'string' ? new Date(body.cursor_created_at) : undefined;
	const cursorId = typeof body.cursor_id === 'string' ? body.cursor_id : undefined;
	const thoughts = await listThoughts(context.userId, {
		limit,
		cursor:
			cursorCreatedAt && cursorId
				? {
						createdAt: cursorCreatedAt,
						id: cursorId
					}
				: undefined
	});
	return { thoughts };
}

export async function runRetrieveThoughtsTool(context: McpToolContext, args: unknown) {
	const body = asObject(args);
	const query = typeof body.query === 'string' ? body.query.trim() : '';
	if (!query) {
		throw new Error('query is required');
	}
	const topK = typeof body.top_k === 'number' ? body.top_k : undefined;
	const threshold = typeof body.threshold === 'number' ? body.threshold : undefined;
	validateSearchParams({ topK, threshold });
	const weights = CONTEXT_WEIGHTS.default;
	const results = await searchThoughts({
		userId: context.userId,
		query,
		topK: topK ?? 20,
		weights
	});
	void tryRecordRetrievalQualityEvent({
		userId: context.userId,
		surface: 'mcp',
		weights,
		topKRequested: topK ?? 20,
		results: results.map((r) => ({ vectorScore: r.vectorScore, graphScore: r.graphScore }))
	});
	const filtered = threshold == null ? results : results.filter((result) => result.score >= threshold);
	return { results: filtered };
}

export async function runDeleteThoughtTool(context: McpToolContext, args: unknown) {
	const body = asObject(args);
	const thoughtId = validateNonEmptyEntityId(
		typeof body.thought_id === 'string' ? body.thought_id : '',
		'thought_id'
	);
	const result = await deleteThoughtForUser(context.userId, thoughtId);
	if (!result.ok) {
		throw new Error('Thought not found');
	}
	return { deleted: true, thoughtId };
}

export async function runEditThoughtTool(context: McpToolContext, args: unknown) {
	const body = asObject(args);
	const thoughtId = validateNonEmptyEntityId(
		typeof body.thought_id === 'string' ? body.thought_id : '',
		'thought_id'
	);
	const editRequest = typeof body.edit_request === 'string' ? body.edit_request.trim() : '';
	if (!editRequest) {
		throw new Error('edit_request is required');
	}
	const [existing] = await getDb()
		.select({
			id: thought.id,
			rawText: thought.rawText,
			normalizedText: thought.normalizedText,
			category: thought.category,
			metadata: thought.metadata
		})
		.from(thought)
		.where(and(eq(thought.id, thoughtId), eq(thought.userId, context.userId)))
		.limit(1);

	if (!existing) {
		throw new Error('Thought not found');
	}

	const priorMeta = (existing.metadata as Record<string, unknown>) ?? {};
	const before = {
		thoughtId: existing.id,
		rawText: existing.rawText,
		normalizedText: existing.normalizedText,
		category: existing.category,
		status: typeof priorMeta.status === 'string' ? priorMeta.status : 'open'
	};

	const updated = await editStoredThought(context.userId, thoughtId, editRequest);
	if (!updated.ok) {
		throw new Error('Thought not found');
	}

	const afterMeta = (updated.thought.metadata as Record<string, unknown>) ?? {};
	return {
		thought: updated.thought,
		thoughtId: updated.thought.id,
		editRequest,
		summary: updated.editSummary,
		before,
		after: {
			rawText: updated.thought.rawText,
			normalizedText: updated.thought.normalizedText,
			category: updated.thought.category,
			status: typeof afterMeta.status === 'string' ? afterMeta.status : 'open'
		}
	};
}

export async function runAnswerQuestionTool(context: McpToolContext, args: unknown) {
	const body = asObject(args);
	const question = typeof body.question === 'string' ? body.question.trim() : '';
	if (!question) {
		throw new Error('question is required');
	}
	const topK = typeof body.top_k === 'number' ? body.top_k : undefined;
	const result = await composeAnswer({
		userId: context.userId,
		question,
		...(topK != null ? { topK } : {})
	});
	return result;
}
