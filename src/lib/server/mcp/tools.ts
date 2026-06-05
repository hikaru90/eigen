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
import { normalizeFusedRrfScore } from '$lib/server/retrieval/rrf-scoring';
import { tryRecordRetrievalQualityEvent } from '$lib/server/retrieval/quality-telemetry';
import { validateNonEmptyEntityId, validateSearchParams } from '$lib/server/validation/mcp-args';
import { sanitizeMcpToolResult } from '$lib/server/observability/strip-embeddings';
import { resolveMcpRetrievalMode } from '$lib/server/mcp/resolve-retrieval-mode';
import { thoughtSnippet } from '$lib/server/mcp/snippet';
import {
	compactTemporalFieldsForMcp,
	enhanceSnippetWithTemporalContext,
	loadTemporalContextByThoughtIds
} from '$lib/server/memory/temporal-context';

export type McpToolProgress = {
	tool: string;
	phase: string;
	label: string;
};

export type McpToolContext = {
	userId: string;
	onToolProgress?: (event: McpToolProgress) => void;
};

function asObject(input: unknown): Record<string, unknown> {
	return input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
}

function parseDetailLevel(body: Record<string, unknown>): 'snippet' | 'full' {
	const detail = body.detail;
	return detail === 'full' ? 'full' : 'snippet';
}

type McpThoughtSnippetRow = {
	id: string;
	category: string;
	createdAt: Date;
	normalizedText: string;
	memoryType?: string | null;
	scoreNormalized?: number;
};

async function buildMcpThoughtSnippetRows(
	userId: string,
	rows: Array<Omit<McpThoughtSnippetRow, 'snippet'> & { score?: number }>,
	weights: { vector: number; graph: number },
	now: Date
): Promise<
	Array<{
		id: string;
		category: string;
		createdAt: Date;
		snippet: string;
		temporalStatus: 'none' | 'active' | 'expired';
		temporalSummary?: string;
		memoryType?: string;
		scoreNormalized?: number;
	}>
> {
	const contextByThoughtId = await loadTemporalContextByThoughtIds({
		userId,
		thoughtIds: rows.map((row) => row.id),
		now
	});

	return rows.map((row) => {
		const ctx = contextByThoughtId.get(row.id);
		const { temporalStatus, temporalSummary } = compactTemporalFieldsForMcp(ctx, now);
		const baseSnippet = thoughtSnippet(row.normalizedText);
		return {
			id: row.id,
			category: row.category,
			createdAt: row.createdAt.toISOString(),
			temporalStatus,
			...(temporalSummary ? { temporalSummary } : {}),
			...(row.memoryType ? { memoryType: row.memoryType } : {}),
			...(typeof row.score === 'number'
				? { scoreNormalized: normalizeFusedRrfScore(row.score, weights) }
				: {}),
			snippet: enhanceSnippetWithTemporalContext({
				snippet: baseSnippet,
				storedAt: row.createdAt,
				temporalStatus,
				temporalSummary
			})
		};
	});
}

export async function runCaptureThoughtTool(context: McpToolContext, args: unknown) {
	const body = asObject(args);
	const raw = typeof body.raw === 'string' ? body.raw : '';
	if (!raw.trim()) {
		throw new Error('raw is required');
	}
	const stored = await captureThought(context.userId, raw);
	return sanitizeMcpToolResult({ thoughtId: stored.id, thought: stored });
}

export async function runListThoughtsTool(context: McpToolContext, args: unknown) {
	const body = asObject(args);
	const limit = typeof body.limit === 'number' ? body.limit : 20;
	const detail = parseDetailLevel(body);
	const cursorCreatedAt =
		typeof body.cursor_created_at === 'string' ? new Date(body.cursor_created_at) : undefined;
	const cursorId = typeof body.cursor_id === 'string' ? body.cursor_id : undefined;
	const thoughts = await listThoughts(context.userId, {
		limit,
		fields: detail === 'full' ? 'full' : 'snippet',
		cursor:
			cursorCreatedAt && cursorId
				? {
						createdAt: cursorCreatedAt,
						id: cursorId
					}
				: undefined
	});

	if (detail === 'full') {
		return sanitizeMcpToolResult({ count: thoughts.length, thoughts });
	}

	const now = new Date();
	const snippetRows = await buildMcpThoughtSnippetRows(
		context.userId,
		thoughts.map((row) => ({
			id: row.id,
			category: row.category,
			createdAt: row.createdAt,
			normalizedText: row.normalizedText,
			memoryType: row.memoryType
		})),
		CONTEXT_WEIGHTS.default,
		now
	);

	return sanitizeMcpToolResult({
		count: snippetRows.length,
		thoughts: snippetRows
	});
}

export async function runRetrieveThoughtsTool(context: McpToolContext, args: unknown) {
	const body = asObject(args);
	const query = typeof body.query === 'string' ? body.query.trim() : '';
	if (!query) {
		throw new Error('query is required');
	}
	const topK = typeof body.top_k === 'number' ? body.top_k : undefined;
	const threshold = typeof body.threshold === 'number' ? body.threshold : undefined;
	const explicitMode =
		body.mode === 'fast' || body.mode === 'full' ? (body.mode as 'fast' | 'full') : undefined;
	const detail = parseDetailLevel(body);
	validateSearchParams({ topK, threshold });
	const weights = CONTEXT_WEIGHTS.default;
	const mode = resolveMcpRetrievalMode(query, explicitMode);
	const effectiveTopK = topK ?? 10;

	const retrieveStart = Date.now();
	console.info('[mcp.tool:retrieve_thoughts] start', { query, topK: effectiveTopK, mode, threshold: threshold ?? null });

	context.onToolProgress?.({
		tool: 'retrieve_thoughts',
		phase: 'searching',
		label: 'Searching your memories…'
	});
	const results = await searchThoughts({
		userId: context.userId,
		query,
		topK: effectiveTopK,
		weights,
		mode
	});
	void tryRecordRetrievalQualityEvent({
		userId: context.userId,
		surface: 'mcp',
		weights,
		topKRequested: effectiveTopK,
		results: results.map((r) => ({ vectorScore: r.vectorScore, graphScore: r.graphScore }))
	});
	const filtered =
		threshold == null
			? results
			: results.filter(
					(result) => normalizeFusedRrfScore(result.score, weights) >= threshold
				);

	if (detail === 'full') {
		const out = sanitizeMcpToolResult({ count: filtered.length, results: filtered });
		console.info('[mcp.tool:retrieve_thoughts] done', {
			durationMs: Date.now() - retrieveStart,
			resultCount: filtered.length
		});
		return out;
	}

	const now = new Date();
	const snippetRows = await buildMcpThoughtSnippetRows(
		context.userId,
		filtered.map((row) => ({
			id: row.id,
			category: row.category,
			createdAt: row.createdAt,
			normalizedText: row.normalizedText,
			score: row.score
		})),
		weights,
		now
	);

	const out = sanitizeMcpToolResult({
		count: snippetRows.length,
		results: snippetRows
	});
	console.info('[mcp.tool:retrieve_thoughts] done', {
		durationMs: Date.now() - retrieveStart,
		resultCount: filtered.length
	});
	return out;
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
	return sanitizeMcpToolResult({ deleted: true, thoughtId });
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
	return sanitizeMcpToolResult({
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
	});
}

export async function runAnswerQuestionTool(context: McpToolContext, args: unknown) {
	const body = asObject(args);
	const question = typeof body.question === 'string' ? body.question.trim() : '';
	if (!question) {
		throw new Error('question is required');
	}
	const topK = typeof body.top_k === 'number' ? body.top_k : undefined;
	const answerStart = Date.now();
	console.info('[mcp.tool:answer_question] start', { question, topK: topK ?? null });
	const result = await composeAnswer({
		userId: context.userId,
		question,
		...(topK != null ? { topK } : {}),
		onProgress: async (phase) => {
			const labels: Record<string, string> = {
				embedding: 'Embedding your question…',
				searching: 'Searching your memories…',
				composing: 'Composing answer from matches…'
			};
			console.info('[mcp.tool:answer_question] progress', { phase });
			context.onToolProgress?.({
				tool: 'answer_question',
				phase,
				label: labels[phase] ?? 'Working…'
			});
		}
	});
	console.info('[mcp.tool:answer_question] done', {
		durationMs: Date.now() - answerStart,
		citationCount: result.citations.length,
		retrievedCount: result.retrieved.length
	});
	return sanitizeMcpToolResult(result);
}
