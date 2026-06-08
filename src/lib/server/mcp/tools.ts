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
import { parseOptionalIsoTimestamp } from '$lib/server/datetime/parse-iso';
import { CONTEXT_WEIGHTS } from '$lib/server/retrieval';
import { normalizeRetrievalScore } from '$lib/server/retrieval/rrf-scoring';
import { tryRecordRetrievalQualityEvent } from '$lib/server/retrieval/quality-telemetry';
import {
	readThoughtIdFromToolArgs,
	validateNonEmptyEntityId,
	validateSearchParams
} from '$lib/server/validation/mcp-args';
import { sanitizeMcpToolResult } from '$lib/server/observability/strip-embeddings';
import {
	completeGroundingSession,
	mergeGroundingFacets
} from '$lib/server/grounding/profile';
import {
	GROUNDING_FACET_KEYS,
	GROUNDING_SUGGEST_COMPLETE_FACET_COUNT,
	type GroundingFacetKey
} from '$lib/server/grounding/constants';
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
				? { scoreNormalized: normalizeRetrievalScore(row.score) }
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
	const capturedAt = parseOptionalIsoTimestamp(body.captured_at, 'captured_at');
	const stored = await captureThought(context.userId, raw, {
		source: 'mcp',
		...(capturedAt ? { capturedAt } : {})
	});
	return sanitizeMcpToolResult({
		thoughtId: stored.id,
		status: stored.queueStatus ?? 'queued',
		thought: stored
	});
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
	const detail = parseDetailLevel(body);
	validateSearchParams({ topK, threshold });
	const weights = CONTEXT_WEIGHTS.default;
	const effectiveTopK = topK ?? 10;

	const retrieveStart = Date.now();
	console.info('[mcp.tool:retrieve_thoughts] start', {
		query,
		topK: effectiveTopK,
		threshold: threshold ?? null
	});

	context.onToolProgress?.({
		tool: 'retrieve_thoughts',
		phase: 'searching',
		label: 'Searching your memories…'
	});
	const results = await searchThoughts({
		userId: context.userId,
		query,
		topK: effectiveTopK
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
					(result) => normalizeRetrievalScore(result.score) >= threshold
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
	const thoughtId = readThoughtIdFromToolArgs(body);
	const result = await deleteThoughtForUser(context.userId, thoughtId);
	if (!result.ok) {
		throw new Error('Thought not found');
	}
	return sanitizeMcpToolResult({ deleted: true, thoughtId });
}

export async function runEditThoughtTool(context: McpToolContext, args: unknown) {
	const body = asObject(args);
	const thoughtId = readThoughtIdFromToolArgs(body);
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

function readEventIdFromToolArgs(body: Record<string, unknown>): string {
	const raw =
		(typeof body.event_id === 'string' ? body.event_id : null) ??
		(typeof body.temporal_event_id === 'string' ? body.temporal_event_id : null);
	const id = raw?.trim() ?? '';
	if (!id || /\s/.test(id)) {
		throw new Error('Invalid event_id: must be a non-empty id without whitespace');
	}
	return id;
}

export async function runListTemporalEventsTool(context: McpToolContext, args: unknown) {
	const body = asObject(args);
	const range =
		typeof body.range === 'string' ? body.range.trim() : 'relevant';
	const status = typeof body.status === 'string' ? body.status.trim() : 'open';
	const { listTemporalEventsForUser } = await import('$lib/server/memory/temporal-event-list');

	const allowedRange = new Set(['relevant', 'upcoming', 'past', 'all']);
	const allowedStatus = new Set(['open', 'all']);

	const { items, nextCursor } = await listTemporalEventsForUser({
		userId: context.userId,
		range: allowedRange.has(range) ? (range as 'relevant' | 'upcoming' | 'past' | 'all') : 'relevant',
		status: allowedStatus.has(status) ? (status as 'open' | 'all') : 'open',
		includeOpenLoops: body.include_open_loops !== false
	});

	return sanitizeMcpToolResult({
		items: items.map((item) => ({
			id: item.id,
			itemType: item.itemType,
			kind: item.kind,
			semanticSummary: item.semanticSummary,
			startAt: item.startAt,
			endAt: item.endAt,
			lifecycleStatus: item.lifecycleStatus,
			snoozedUntil: item.snoozedUntil,
			durationMinutes: item.durationMinutes,
			energyLevel: item.energyLevel,
			priorityQuadrant: item.priorityQuadrant,
			contextTags: item.contextTags,
			thoughtId: item.thoughtId
		})),
		nextCursor
	});
}

export async function runManageTemporalEventTool(context: McpToolContext, args: unknown) {
	const body = asObject(args);
	const eventId = readEventIdFromToolArgs(body);
	const action = typeof body.action === 'string' ? body.action.trim() : '';
	const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';

	const {
		applyNlTemporalEventAction,
		applyQuickTemporalEventAction,
		applyStructuredRescheduleAction,
		applyStructuredSnoozeAction,
		deleteTemporalEventForUser
	} = await import('$lib/server/memory/temporal-event-service');

	const startAt = typeof body.start_at === 'string' ? body.start_at.trim() : '';
	const endAt = typeof body.end_at === 'string' ? body.end_at.trim() : '';
	const snoozedUntil = typeof body.snoozed_until === 'string' ? body.snoozed_until.trim() : '';

	if (action === 'reschedule' && startAt) {
		const result = await applyStructuredRescheduleAction(context.userId, eventId, {
			startAt,
			endAt: endAt || null
		});
		return sanitizeMcpToolResult({ eventId, ...result });
	}

	if (action === 'snooze' && snoozedUntil) {
		const result = await applyStructuredSnoozeAction(context.userId, eventId, snoozedUntil);
		return sanitizeMcpToolResult({ eventId, ...result });
	}

	if (action === 'delete') {
		const result = await deleteTemporalEventForUser(context.userId, eventId);
		return sanitizeMcpToolResult({ eventId, ...result });
	}

	const quickActions = new Set(['mark_done', 'reopen', 'cancel', 'dismiss']);
	if (action && quickActions.has(action)) {
		const result = await applyQuickTemporalEventAction(
			context.userId,
			eventId,
			action as 'mark_done' | 'reopen' | 'cancel' | 'dismiss'
		);
		return sanitizeMcpToolResult({ eventId, ...result });
	}

	if (instruction) {
		const result = await applyNlTemporalEventAction(context.userId, eventId, instruction);
		return sanitizeMcpToolResult({ eventId, ...result });
	}

	throw new Error('Provide action (mark_done|reopen|cancel|dismiss|delete) or instruction');
}

export async function runAnswerQuestionTool(context: McpToolContext, args: unknown) {
	const body = asObject(args);
	const question = typeof body.question === 'string' ? body.question.trim() : '';
	if (!question) {
		throw new Error('question is required');
	}
	const topK = typeof body.top_k === 'number' ? body.top_k : undefined;
	const referenceTime = parseOptionalIsoTimestamp(body.reference_time, 'reference_time');
	const answerStart = Date.now();
	console.info('[mcp.tool:answer_question] start', { question, topK: topK ?? null });
	const result = await composeAnswer({
		userId: context.userId,
		question,
		...(topK != null ? { topK } : {}),
		...(referenceTime ? { referenceTime } : {}),
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

function parseGroundingFacetsArg(body: Record<string, unknown>): Array<{ key: string; content: string }> {
	const raw = body.facets;
	if (!Array.isArray(raw) || raw.length === 0) {
		throw new Error('facets is required and must be a non-empty array');
	}
	const facets: Array<{ key: string; content: string }> = [];
	for (const item of raw) {
		if (!item || typeof item !== 'object') {
			throw new Error('Each facet must be an object with key and content');
		}
		const o = item as Record<string, unknown>;
		if (typeof o.key !== 'string' || typeof o.content !== 'string') {
			throw new Error('Each facet must have string key and content');
		}
		facets.push({ key: o.key, content: o.content });
	}
	return facets;
}

export async function runCaptureGroundingTool(context: McpToolContext, args: unknown) {
	const body = asObject(args);
	const facets = parseGroundingFacetsArg(body);
	const sessionNote = typeof body.session_note === 'string' ? body.session_note.trim() : undefined;
	const snapshot = await mergeGroundingFacets({
		userId: context.userId,
		facets: facets as Array<{ key: GroundingFacetKey; content: string }>,
		synthesizeNarrative: false,
		...(sessionNote ? { sessionNote } : {})
	});
	const facetKeys = Object.keys(snapshot.facets);
	const facetCount = facetKeys.length;
	return sanitizeMcpToolResult({
		ok: true,
		facetKeys,
		facetCount,
		suggestComplete: facetCount >= GROUNDING_SUGGEST_COMPLETE_FACET_COUNT,
		initialCompleted: snapshot.initialCompletedAt != null,
		allowedFacetKeys: [...GROUNDING_FACET_KEYS]
	});
}

export async function runCompleteGroundingSessionTool(context: McpToolContext, args: unknown) {
	const body = asObject(args);
	const synthesis = typeof body.synthesis === 'string' ? body.synthesis.trim() : undefined;
	const result = await completeGroundingSession({
		userId: context.userId,
		...(synthesis ? { synthesis } : {})
	});
	return sanitizeMcpToolResult({
		ok: true,
		initialCompleted: result.initialCompleted,
		redirectTo: result.redirectTo,
		facetCount: Object.keys(result.snapshot.facets).length,
		sessionCount: result.snapshot.sessionCount
	});
}
