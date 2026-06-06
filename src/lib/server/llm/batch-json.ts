import { stripMarkdownJsonFences } from '$lib/server/memory/llm-json-content';

export type BatchItemRef = { id: string };

/** Extract assistant message content from an LLM chat completion response. */
export function extractBatchChatContent(response: unknown, label: string): string {
	if (!response || typeof response !== 'object') {
		throw new Error(`${label}: response is not an object`);
	}
	const choices = (response as { choices?: unknown }).choices;
	if (!Array.isArray(choices) || choices.length === 0) {
		throw new Error(`${label}: no choices in response`);
	}
	const content = (choices[0] as { message?: { content?: unknown } }).message?.content;
	if (typeof content !== 'string') {
		throw new Error(`${label}: content is not a string`);
	}
	return stripMarkdownJsonFences(content);
}

/**
 * Parse a batch LLM JSON array response. Each element must have an `id` matching
 * one of the requested items. Returns a Map keyed by id; throws if any id is missing.
 */
export function parseBatchJsonArray<T extends BatchItemRef>(
	content: string,
	expectedIds: readonly string[],
	label: string,
	parseItem: (id: string, value: unknown) => T extends BatchItemRef ? Omit<T, 'id'> & BatchItemRef : never
): Map<string, ReturnType<typeof parseItem>> {
	const parsed = JSON.parse(content) as unknown;
	if (!Array.isArray(parsed)) {
		throw new Error(`${label}: output must be a JSON array`);
	}
	const byId = new Map<string, ReturnType<typeof parseItem>>();
	for (const entry of parsed) {
		if (!entry || typeof entry !== 'object') continue;
		const id = (entry as { id?: unknown }).id;
		if (typeof id !== 'string' || !id.trim()) continue;
		const key = id.trim();
		if (byId.has(key)) {
			throw new Error(`${label}: duplicate id "${key}" in batch response`);
		}
		byId.set(key, parseItem(key, entry));
	}
	const missing = expectedIds.filter((id) => !byId.has(id));
	if (missing.length > 0) {
		throw new Error(
			`${label}: batch size mismatch — missing ids: ${missing.join(', ')} (expected ${expectedIds.length}, got ${byId.size})`
		);
	}
	return byId;
}
