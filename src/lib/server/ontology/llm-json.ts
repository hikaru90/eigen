import type { ChatMessage } from '$lib/server/llm/llm-client';

export function extractChatContent(response: unknown): string {
	if (!response || typeof response !== 'object') {
		throw new Error('LLM response is not an object');
	}
	const choices = (response as { choices?: unknown }).choices;
	if (!Array.isArray(choices) || choices.length === 0) {
		throw new Error('LLM response has no choices');
	}
	const message = (choices[0] as { message?: unknown }).message;
	if (!message || typeof message !== 'object') {
		throw new Error('LLM response has no message');
	}
	const content = (message as { content?: unknown }).content;
	if (typeof content !== 'string') {
		throw new Error('LLM message content must be a string');
	}
	return content;
}

export function userMessage(content: string): ChatMessage {
	return { role: 'user', content };
}
