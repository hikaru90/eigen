import { THOUGHT_SNIPPET_MAX_CHARS } from '$lib/server/llm/agent-tool-result-compact';

export function thoughtSnippet(text: string, max = THOUGHT_SNIPPET_MAX_CHARS): string {
	const trimmed = text.trim();
	if (trimmed.length <= max) return trimmed;
	return `${trimmed.slice(0, max - 3)}...`;
}
