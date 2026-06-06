/**
 * LLM retrieval-scope classifier (AC-025).
 * Language-agnostic: global sensemaking vs local factual recall.
 */

import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client';
import { parseLlmJsonPayload } from '$lib/server/memory/llm-json-content';

export type RetrievalScope = 'global' | 'local';

export const RETRIEVAL_SCOPE_CLASSIFIER_PROMPT = [
	'You classify questions for a personal memory assistant. Return JSON only — no markdown fences.',
	'',
	'Return exactly one of:',
	'{"scope":"global"}',
	'{"scope":"local"}',
	'',
	'global — Corpus-wide sensemaking: themes, patterns, recurring concerns, self-profile synthesis, or questions about what the user is "about" overall. The answer requires integrating many memories, not retrieving one specific fact. Applies in any language.',
	'',
	'local — Specific fact lookup: named entity ("who is X"), one detail from memory, where/when/how about a concrete thing, or any question answerable from one or a few stored thoughts. Applies in any language.',
	'',
	'Classify by intent, not by keywords or language.'
].join('\n');

export function parseRetrievalScopeResponse(text: string): RetrievalScope {
	const parsed = parseLlmJsonPayload(text);
	if (!parsed || typeof parsed !== 'object') {
		throw new Error('retrieval scope classifier: response is not a JSON object');
	}
	const scope = (parsed as { scope?: unknown }).scope;
	if (scope === 'global' || scope === 'local') return scope;
	throw new Error('retrieval scope classifier: scope must be "global" or "local"');
}

export async function classifyRetrievalScope(params: {
	userId: string;
	query: string;
}): Promise<RetrievalScope> {
	const query = params.query.trim();
	if (!query) {
		throw new Error('classifyRetrievalScope: query must be non-empty');
	}

	const messages: ChatMessage[] = [
		{ role: 'system', content: RETRIEVAL_SCOPE_CLASSIFIER_PROMPT },
		{ role: 'user', content: query }
	];

	const raw = await llmChatCompletion({
		userId: params.userId,
		messages,
		temperature: 0,
		logContext: 'retrieval_scope_classifier'
	});

	const content =
		(raw as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content?.trim() ??
		'';
	if (!content) {
		throw new Error('retrieval scope classifier: empty LLM response');
	}

	return parseRetrievalScopeResponse(content);
}
