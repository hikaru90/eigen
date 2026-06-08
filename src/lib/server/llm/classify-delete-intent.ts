/**
 * LLM delete-intent classifier — gates auto-delete after retrieve_thoughts.
 * Language-agnostic: permanent removal of an existing stored thought vs other intents.
 */

import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client';
import { parseLlmJsonPayload } from '$lib/server/memory/llm-json-content';

export const DELETE_INTENT_CLASSIFIER_PROMPT = [
	'You classify whether the user wants to permanently delete or remove an existing stored thought from their personal memory.',
	'Return JSON only — no markdown fences.',
	'',
	'Return exactly one of:',
	'{"delete":true}',
	'{"delete":false}',
	'',
	'delete true — The user explicitly wants an existing memory/thought removed (e.g. "delete the salmon note", "remove that task", "get rid of the grocery list", "lösche die Notiz über Milch").',
	'',
	'delete false — Questions, new captures, edits/completions, listing, or any request that does not ask to remove a stored thought.',
	'Examples of false: "what did I note about salmon?", "remember I love mirin", "mark the grocery task done", "show my recent thoughts".',
	'',
	'Classify by intent, not by keywords or language.'
].join('\n');

export function parseDeleteIntentResponse(text: string): boolean {
	const parsed = parseLlmJsonPayload(text);
	if (!parsed || typeof parsed !== 'object') {
		throw new Error('delete intent classifier: response is not a JSON object');
	}
	const value = (parsed as { delete?: unknown }).delete;
	if (value === true) return true;
	if (value === false) return false;
	throw new Error('delete intent classifier: delete must be true or false');
}

export async function classifyDeleteIntent(params: {
	userId: string;
	userMessage: string;
}): Promise<boolean> {
	const message = params.userMessage.trim();
	if (!message) return false;

	const messages: ChatMessage[] = [
		{ role: 'system', content: DELETE_INTENT_CLASSIFIER_PROMPT },
		{ role: 'user', content: message }
	];

	const raw = await llmChatCompletion({
		userId: params.userId,
		messages,
		temperature: 0,
		logContext: 'delete_intent_classifier'
	});

	const content =
		(raw as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content?.trim() ??
		'';
	if (!content) {
		throw new Error('delete intent classifier: empty LLM response');
	}

	return parseDeleteIntentResponse(content);
}
