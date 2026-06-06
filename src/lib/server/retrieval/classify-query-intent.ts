/**
 * Unified LLM query classifier — retrieval scope + temporal intent in one call.
 */

import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client';
import { parseLlmJsonPayload } from '$lib/server/memory/llm-json-content';
import type { RetrievalScope } from '$lib/server/retrieval/global-query';

export type TemporalQuestionKind = 'ordering' | 'duration' | 'absolute' | 'none';

export type QueryIntent = {
	scope: RetrievalScope;
	temporal: boolean;
	kind: TemporalQuestionKind;
	entityHints: string[];
	timeWindow: { start: Date; end: Date } | null;
};

export const QUERY_INTENT_CLASSIFIER_PROMPT = [
	'You classify questions for a personal memory assistant. Return JSON only — no markdown fences.',
	'',
	'Return exactly one object with these keys:',
	'{"scope":"global"|"local","temporal":boolean,"kind":"ordering"|"duration"|"absolute"|"none","entityHints":string[],"timeWindowStart":"ISO-8601 or omit","timeWindowEnd":"ISO-8601 or omit"}',
	'',
	'scope global — Corpus-wide sensemaking: themes, patterns, self-profile synthesis. Requires integrating many memories.',
	'scope local — Specific fact lookup answerable from one or a few stored thoughts.',
	'',
	'temporal true — Question requires comparing dates, ordering events in time, counting days/weeks between events, or when something happened relative to another event.',
	'temporal false — No timeline comparison or date arithmetic needed.',
	'',
	'kind ordering — Which event/person/thing came first or happened earlier.',
	'kind duration — How many days/weeks/months between two events or dates.',
	'kind absolute — When did a specific event happen (single date).',
	'kind none — Not a temporal reasoning question.',
	'',
	'entityHints — Named entities, events, or objects the question compares (verbatim phrases from the question). Empty array if none.',
	'timeWindowStart/timeWindowEnd — Optional ISO bounds when the question implies a calendar window; omit when unknown.',
	'',
	'Classify by intent, not by keywords or language.'
].join('\n');

function parseOptionalWindowBound(value: unknown, field: string): Date | null {
	if (value == null || value === '') return null;
	if (typeof value !== 'string') {
		throw new Error(`query intent classifier: ${field} must be an ISO-8601 string or omitted`);
	}
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		throw new Error(`query intent classifier: ${field} is not a valid ISO-8601 timestamp`);
	}
	return parsed;
}

export function parseQueryIntentResponse(text: string): QueryIntent {
	const parsed = parseLlmJsonPayload(text);
	if (!parsed || typeof parsed !== 'object') {
		throw new Error('query intent classifier: response is not a JSON object');
	}
	const obj = parsed as Record<string, unknown>;
	const scope = obj.scope;
	if (scope !== 'global' && scope !== 'local') {
		throw new Error('query intent classifier: scope must be "global" or "local"');
	}
	const temporal = obj.temporal;
	if (typeof temporal !== 'boolean') {
		throw new Error('query intent classifier: temporal must be a boolean');
	}
	const kind = obj.kind;
	if (kind !== 'ordering' && kind !== 'duration' && kind !== 'absolute' && kind !== 'none') {
		throw new Error('query intent classifier: kind must be ordering, duration, absolute, or none');
	}
	const rawHints = obj.entityHints;
	if (!Array.isArray(rawHints)) {
		throw new Error('query intent classifier: entityHints must be an array');
	}
	const entityHints = rawHints
		.filter((h): h is string => typeof h === 'string')
		.map((h) => h.trim())
		.filter((h) => h.length > 0);
	const start = parseOptionalWindowBound(obj.timeWindowStart, 'timeWindowStart');
	const end = parseOptionalWindowBound(obj.timeWindowEnd, 'timeWindowEnd');
	const timeWindow =
		start && end
			? start.getTime() <= end.getTime()
				? { start, end }
				: { start: end, end: start }
			: null;
	return { scope, temporal, kind, entityHints, timeWindow };
}

export async function classifyQueryIntent(params: {
	userId: string;
	query: string;
}): Promise<QueryIntent> {
	const query = params.query.trim();
	if (!query) {
		throw new Error('classifyQueryIntent: query must be non-empty');
	}

	const messages: ChatMessage[] = [
		{ role: 'system', content: QUERY_INTENT_CLASSIFIER_PROMPT },
		{ role: 'user', content: query }
	];

	const raw = await llmChatCompletion({
		userId: params.userId,
		messages,
		temperature: 0,
		logContext: 'query_intent_classifier'
	});

	const content =
		(raw as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content?.trim() ??
		'';
	if (!content) {
		throw new Error('query intent classifier: empty LLM response');
	}

	return parseQueryIntentResponse(content);
}

/** Back-compat wrapper — prefer classifyQueryIntent for temporal-aware routing. */
export async function classifyRetrievalScopeFromIntent(params: {
	userId: string;
	query: string;
}): Promise<RetrievalScope> {
	const intent = await classifyQueryIntent(params);
	return intent.scope;
}
