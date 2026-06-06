/**
 * LLM chat-intent classifier — safety gate before capture_thought from chat routing.
 * Language-agnostic: question vs explicit save vs manage (edit/delete/list).
 */

import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client';
import { parseLlmJsonPayload } from '$lib/server/memory/llm-json-content';

export type ChatIntent = 'answer' | 'capture' | 'manage';

export const CHAT_INTENT_CLASSIFIER_PROMPT = [
	'You classify user messages for a personal memory assistant chat. Return JSON only — no markdown fences.',
	'',
	'Return exactly one of:',
	'{"intent":"answer"}',
	'{"intent":"capture"}',
	'{"intent":"manage"}',
	'',
	'answer — The user is asking a question (how/what/when/who/why), seeking information from memory, or requesting an explanation. Applies in any language. Examples: "Wie koche ich Japanese-Glazed Salmon?", "What did I note about Priya?", "Where am I staying?"',
	'',
	'capture — The user explicitly wants to save, remember, or note something new for later. They must clearly intend to store text, not ask a question. Examples: "remember that my salmon glaze uses mirin", "save this: meeting at 3pm", "note to self: call Jonas".',
	'',
	'manage — The user wants to edit, delete, list, or report completing/updating an existing stored thought (without providing a thought id). Examples: "delete the salmon note", "I finished the grocery task", "show my recent thoughts".',
	'',
	'Classify by intent, not by keywords or language. Questions are never capture.'
].join('\n');

export function parseChatIntentResponse(text: string): ChatIntent {
	const parsed = parseLlmJsonPayload(text);
	if (!parsed || typeof parsed !== 'object') {
		throw new Error('chat intent classifier: response is not a JSON object');
	}
	const intent = (parsed as { intent?: unknown }).intent;
	if (intent === 'answer' || intent === 'capture' || intent === 'manage') return intent;
	throw new Error('chat intent classifier: intent must be "answer", "capture", or "manage"');
}

export async function classifyChatIntent(params: {
	userId: string;
	userMessage: string;
}): Promise<ChatIntent> {
	const message = params.userMessage.trim();
	if (!message) {
		throw new Error('classifyChatIntent: userMessage must be non-empty');
	}

	const messages: ChatMessage[] = [
		{ role: 'system', content: CHAT_INTENT_CLASSIFIER_PROMPT },
		{ role: 'user', content: message }
	];

	const raw = await llmChatCompletion({
		userId: params.userId,
		messages,
		temperature: 0,
		logContext: 'chat_intent_classifier'
	});

	const content =
		(raw as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content?.trim() ??
		'';
	if (!content) {
		throw new Error('chat intent classifier: empty LLM response');
	}

	return parseChatIntentResponse(content);
}
