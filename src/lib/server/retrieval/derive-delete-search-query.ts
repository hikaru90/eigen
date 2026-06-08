/**
 * LLM judge: derive semantic search queries from a delete request.
 * Delete wording ("delete all recipes") is poor for embedding search — queries must
 * describe the content to find (dishes, people, tasks), not the removal action.
 */

import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client';
import { parseLlmJsonPayload } from '$lib/server/memory/llm-json-content';

export const DERIVE_DELETE_SEARCH_QUERY_PROMPT = [
	'You convert a delete/remove request into semantic search queries to find matching stored memories.',
	'Return JSON only — no markdown fences.',
	'',
	'Return exactly: {"queries":["...", ...]} with 1 to 4 short search phrases.',
	'',
	'Each query should describe the CONTENT the user wants removed — dishes, people, tasks, notes, events.',
	'Do NOT include words like delete, remove, erase, or drop in the queries.',
	'Use the same language as the delete request when helpful.',
	'',
	'Examples:',
	'- "delete all recipes" → ["recipes cooking dishes meals", "food ingredients preparation instructions"]',
	'- "delete the shakshuka and caesar salad" → ["shakshuka", "caesar salad"]',
	'- "remove everything about Jonas" → ["Jonas"]',
	'- "lösche alle Rezepte" → ["Rezepte Kochen Gerichte", "Essen Zutaten Zubereitung"]'
].join('\n');

const MAX_QUERIES = 4;

export function parseDeleteSearchQueriesResponse(text: string): string[] {
	const parsed = parseLlmJsonPayload(text);
	if (!parsed || typeof parsed !== 'object') {
		throw new Error('delete search query: response is not a JSON object');
	}
	const raw = (parsed as { queries?: unknown }).queries;
	if (!Array.isArray(raw) || raw.length === 0) {
		throw new Error('delete search query: queries must be a non-empty array');
	}
	const queries: string[] = [];
	for (const entry of raw.slice(0, MAX_QUERIES)) {
		if (typeof entry !== 'string' || !entry.trim()) {
			throw new Error('delete search query: each query must be a non-empty string');
		}
		queries.push(entry.trim());
	}
	return queries;
}

export async function deriveDeleteSearchQueries(params: {
	userId: string;
	deleteRequest: string;
}): Promise<string[]> {
	const request = params.deleteRequest.trim();
	if (!request) {
		throw new Error('deriveDeleteSearchQueries: deleteRequest must be non-empty');
	}

	const messages: ChatMessage[] = [
		{ role: 'system', content: DERIVE_DELETE_SEARCH_QUERY_PROMPT },
		{ role: 'user', content: `Delete request: ${request}` }
	];

	const raw = await llmChatCompletion({
		userId: params.userId,
		messages,
		temperature: 0,
		logContext: 'delete_search_query'
	});

	const content =
		(raw as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content?.trim() ??
		'';
	if (!content) {
		throw new Error('delete search query: empty LLM response');
	}

	return parseDeleteSearchQueriesResponse(content);
}
