import { CONTEXT_WEIGHTS } from '$lib/server/retrieval';
import { stripEmbeddingsFromValue } from '$lib/server/observability/strip-embeddings';
import {
	normalizeRetrievalScore,
	type RetrievalFusionWeights
} from '$lib/server/retrieval/rrf-scoring';

/** Normalized fused RRF score at or above this counts as a "strong" delete target. */
export const STRONG_RETRIEVE_MATCH_MIN = 0.45;

export const THOUGHT_SNIPPET_MAX_CHARS = 200;
const SNIPPET_MAX_CHARS = THOUGHT_SNIPPET_MAX_CHARS;
const MAX_CANDIDATES = 20;
/** Hard cap on JSON length fed back into the agent LLM after a tool call. */
export const MAX_TOOL_RESULT_JSON_CHARS = 12_000;
/** Cap on streamed tool_result preview payloads shown in chat UI. */
export const MAX_TOOL_RESULT_PREVIEW_CHARS = 8_000;

const DELETE_INTENT_RE =
	/\b(delete|remove|erase|drop|get rid of|throw away|discard)\b/i;

export function isDeleteIntent(userMessage: string): boolean {
	return DELETE_INTENT_RE.test(userMessage.trim());
}

function snippet(text: string, max = SNIPPET_MAX_CHARS): string {
	const trimmed = text.trim();
	if (trimmed.length <= max) return trimmed;
	return `${trimmed.slice(0, max - 3)}...`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function compactThoughtRow(row: Record<string, unknown>) {
	const text =
		typeof row.normalizedText === 'string'
			? row.normalizedText
			: typeof row.rawText === 'string'
				? row.rawText
				: typeof row.text === 'string'
					? row.text
					: '';
	return {
		id: typeof row.id === 'string' ? row.id : undefined,
		thoughtId: typeof row.thoughtId === 'string' ? row.thoughtId : undefined,
		category: typeof row.category === 'string' ? row.category : undefined,
		snippet: text ? snippet(text) : typeof row.snippet === 'string' ? row.snippet : undefined,
		createdAt:
			row.createdAt instanceof Date
				? row.createdAt.toISOString()
				: typeof row.createdAt === 'string'
					? row.createdAt
					: undefined,
		temporalStatus:
			row.temporalStatus === 'none' ||
			row.temporalStatus === 'active' ||
			row.temporalStatus === 'expired'
				? row.temporalStatus
				: undefined,
		temporalSummary:
			typeof row.temporalSummary === 'string' ? row.temporalSummary : undefined
	};
}

function compactRetrieveResults(
	results: unknown[],
	weights: RetrievalFusionWeights
): { count: number; candidates: Array<Record<string, unknown>>; truncated: boolean } {
	const slice = results.slice(0, MAX_CANDIDATES);
	const candidates = slice.map((row) => {
		const r = asRecord(row) ?? {};
		const score = typeof r.score === 'number' ? r.score : 0;
		return {
			...compactThoughtRow(r),
			scoreNormalized: normalizeRetrievalScore(score)
		};
	});
	return {
		count: results.length,
		candidates,
		truncated: results.length > slice.length
	};
}

/**
 * When exactly one retrieved hit is strong enough, the agent may delete without disambiguation.
 */
export function findUniqueStrongRetrieveMatch(
	results: unknown[],
	weights: RetrievalFusionWeights = CONTEXT_WEIGHTS.default
): { id: string; snippet: string } | null {
	if (!Array.isArray(results) || results.length === 0) return null;

	const strong: Array<{ id: string; snippet: string; scoreNormalized: number }> = [];
	for (const row of results) {
		const r = asRecord(row);
		if (!r || typeof r.id !== 'string') continue;
		const score = typeof r.score === 'number' ? r.score : 0;
		const scoreNormalized = normalizeRetrievalScore(score);
		if (scoreNormalized < STRONG_RETRIEVE_MATCH_MIN) continue;
		const text =
			typeof r.normalizedText === 'string'
				? r.normalizedText
				: typeof r.rawText === 'string'
					? r.rawText
					: '';
		strong.push({ id: r.id, snippet: snippet(text), scoreNormalized });
	}

	if (strong.length !== 1) return null;
	return { id: strong[0].id, snippet: strong[0].snippet };
}

export function compactToolResultForLlm(
	tool: string,
	result: unknown,
	weights: RetrievalFusionWeights = CONTEXT_WEIGHTS.default
): unknown {
	if (result == null) return result;
	const stripped = stripEmbeddingsFromValue(result);
	if (stripped == null) return stripped;
	const obj = asRecord(stripped);
	if (!obj) return result;

	if (tool === 'retrieve_thoughts' && Array.isArray(obj.results)) {
		return compactRetrieveResults(obj.results, weights);
	}

	if (tool === 'list_thoughts' && Array.isArray(obj.thoughts)) {
		const thoughts = obj.thoughts.slice(0, MAX_CANDIDATES).map((row) => compactThoughtRow(asRecord(row) ?? {}));
		return {
			count: obj.thoughts.length,
			thoughts,
			truncated: obj.thoughts.length > thoughts.length
		};
	}

	if (tool === 'edit_thought') {
		return {
			thoughtId: obj.thoughtId,
			summary: obj.summary,
			editRequest: obj.editRequest,
			before: compactThoughtRow(asRecord(obj.before) ?? {}),
			after: compactThoughtRow(asRecord(obj.after) ?? {})
		};
	}

	if (tool === 'capture_thought') {
		const thought = asRecord(obj.thought);
		return {
			thoughtId: obj.thoughtId,
			thought: thought ? compactThoughtRow(thought) : undefined
		};
	}

	if (tool === 'answer_question') {
		const compact: Record<string, unknown> = {
			answer:
				typeof obj.answer === 'string' ? snippet(obj.answer, 2_000) : undefined,
			citationCount: Array.isArray(obj.citations) ? obj.citations.length : 0
		};
		if (typeof obj.error === 'string' && obj.error.trim()) {
			compact.error = snippet(obj.error, 500);
		}
		return compact;
	}

	return result;
}

function compactRetrievedThoughtsForPreview(retrieved: unknown): Array<Record<string, unknown>> | undefined {
	if (!Array.isArray(retrieved)) return undefined;
	const rows = retrieved
		.slice(0, MAX_CANDIDATES)
		.map((row) => compactThoughtRow(asRecord(row) ?? {}))
		.filter((row) => row.id || row.snippet);
	return rows.length > 0 ? rows : undefined;
}

function capJsonString(json: string, maxChars: number): string {
	if (json.length <= maxChars) return json;
	return `${json.slice(0, maxChars - 40)}\n…[truncated ${json.length - maxChars + 40} chars]`;
}

export function formatToolResultForAgentMessage(tool: string, result: unknown): string {
	const compact = compactToolResultForLlm(tool, result);
	const json = JSON.stringify(compact, null, 2);
	return capJsonString(json, MAX_TOOL_RESULT_JSON_CHARS);
}

export function formatToolResultPreview(tool: string, result: unknown): string {
	const compact = compactToolResultForLlm(tool, result);
	let preview: unknown = compact;
	if (tool === 'answer_question') {
		const obj = asRecord(stripEmbeddingsFromValue(result));
		const compactObj = asRecord(compact) ?? {};
		if (obj) {
			preview = {
				...compactObj,
				answer: typeof obj.answer === 'string' ? obj.answer : compactObj.answer,
				citations: Array.isArray(obj.citations) ? obj.citations : undefined,
				retrieved: compactRetrievedThoughtsForPreview(obj.retrieved)
			};
		}
	}
	const json = JSON.stringify(preview);
	return capJsonString(json, MAX_TOOL_RESULT_PREVIEW_CHARS);
}
