export type ChatToolCallEntry = {
	role: 'assistant';
	variant: 'tool_call';
	tool: string;
	arguments: Record<string, unknown>;
	progress?: string;
	status?: 'running' | 'done' | 'error';
	result?: string;
	/** Human-readable summary persisted alongside raw tool JSON (tool_step rows). */
	displaySummary?: string;
};

export type ChatToolResultEntry = {
	role: 'assistant';
	variant: 'tool_result';
	tool: string;
	content: string;
	status: 'success' | 'error';
	displaySummary?: string;
};

export type ChatDisplayEntry =
	| { role: 'user'; content: string }
	| { role: 'assistant'; variant: 'text'; content: string }
	| { role: 'assistant'; variant: 'thinking'; content: string }
	| ChatToolCallEntry
	| ChatToolResultEntry;

export type StoredChatStep = {
	content: string;
	metadata: Record<string, unknown>;
};

export function normalizeAnswerText(text: string): string {
	return text.replace(/\r\n/g, '\n').trim();
}

/** Merge adjacent persisted tool_call + tool_result rows into one in-memory tool card. */
export function mergeToolCallPairs(entries: ChatDisplayEntry[]): ChatDisplayEntry[] {
	const merged: ChatDisplayEntry[] = [];
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		const next = entries[i + 1];
		if (
			entry.role === 'assistant' &&
			entry.variant === 'tool_call' &&
			next?.role === 'assistant' &&
			next.variant === 'tool_result' &&
			entry.tool === next.tool
		) {
			merged.push({
				...entry,
				progress: undefined,
				status: next.status === 'error' ? 'error' : 'done',
				result: next.content,
				displaySummary: next.displaySummary
			});
			i += 1;
			const afterTool = entries[i + 1];
			if (
				entry.tool === 'answer_question' &&
				afterTool?.role === 'assistant' &&
				afterTool.variant === 'text' &&
				normalizeAnswerText(afterTool.content) === normalizeAnswerText(next.content)
			) {
				i += 1;
			}
			continue;
		}
		merged.push(entry);
	}
	return merged;
}

/** Collapse duplicate tool cards and drop redundant final text after Q&A compose. */
export function normalizeChatDisplay(entries: ChatDisplayEntry[]): ChatDisplayEntry[] {
	const merged = mergeToolCallPairs(entries);
	const out: ChatDisplayEntry[] = [];

	for (const entry of merged) {
		const prev = out.at(-1);

		if (entry.role === 'assistant' && entry.variant === 'tool_result') {
			if (
				prev?.role === 'assistant' &&
				prev.variant === 'tool_call' &&
				prev.tool === entry.tool &&
				prev.status &&
				prev.status !== 'running'
			) {
				continue;
			}
		}

		if (
			entry.role === 'assistant' &&
			entry.variant === 'text' &&
			prev?.role === 'assistant' &&
			prev.variant === 'tool_call' &&
			prev.tool === 'answer_question' &&
			prev.status === 'done' &&
			prev.result
		) {
			continue;
		}

		if (
			entry.role === 'assistant' &&
			entry.variant === 'tool_call' &&
			entry.tool === 'answer_question' &&
			entry.status === 'done' &&
			prev?.role === 'assistant' &&
			prev.variant === 'tool_call' &&
			prev.tool === 'answer_question' &&
			prev.status === 'done' &&
			normalizeAnswerText(prev.result ?? '') === normalizeAnswerText(entry.result ?? '')
		) {
			continue;
		}

		out.push(entry);
	}

	return out;
}

/** Persist one row per tool run instead of separate tool_call + tool_result rows. */
export function compactChatIntermediateSteps(steps: StoredChatStep[]): StoredChatStep[] {
	const out: StoredChatStep[] = [];
	for (let i = 0; i < steps.length; i++) {
		const cur = steps[i];
		const next = steps[i + 1];
		const tool = cur.metadata.tool;
		if (
			cur.metadata.variant === 'tool_call' &&
			next?.metadata.variant === 'tool_result' &&
			typeof tool === 'string' &&
			tool === next.metadata.tool
		) {
			out.push({
				content: next.content,
				metadata: {
					variant: 'tool_step',
					tool,
					arguments: cur.metadata.arguments ?? {},
					displaySummary: next.metadata.displaySummary,
					failed: next.metadata.failed === true
				}
			});
			i += 1;
			continue;
		}
		out.push(cur);
	}
	return out;
}

export function shouldSkipDuplicateFinalAnswer(steps: StoredChatStep[]): boolean {
	return steps.some(
		(s) => s.metadata.variant === 'tool_step' && s.metadata.tool === 'answer_question'
	);
}

export function toolStepToDisplayEntry(input: {
	tool: string;
	arguments?: Record<string, unknown>;
	displaySummary?: string;
	content: string;
	failed?: boolean;
}): ChatToolCallEntry {
	return {
		role: 'assistant',
		variant: 'tool_call',
		tool: input.tool,
		arguments: input.arguments ?? {},
		status: input.failed ? 'error' : 'done',
		result: input.content,
		displaySummary: input.displaySummary
	};
}
