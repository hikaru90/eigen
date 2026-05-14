export type ChatStreamEvent =
	| { type: 'thinking'; content: string }
	| { type: 'tool_call'; tool: string; arguments: Record<string, unknown> }
	| { type: 'tool_result'; tool: string; preview: string }
	| { type: 'done'; response: string; sessionId: string; messageId: string }
	| { type: 'error'; error: string; details?: string[] };

export const CHAT_TOOL_COPY: Record<string, { title: string }> = {
	retrieve_thoughts: { title: 'Searching your memories' },
	answer_question: { title: 'Analyzing and composing answer' },
	edit_thought: { title: 'Updating thought' }
};

export function toolLabel(tool: string): string {
	return CHAT_TOOL_COPY[tool]?.title ?? `Running ${tool}`;
}
