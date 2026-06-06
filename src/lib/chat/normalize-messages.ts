import { looksLikeRawToolJson, parseFinalAnswerText } from './chat-stream-types';

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

export type ChatTimelineKind =
	| 'llm_progress'
	| 'tool_call'
	| 'tool_executing'
	| 'tool_progress'
	| 'tool_result';

export type ChatTimelineEntry = {
	role: 'assistant';
	variant: 'timeline';
	kind: ChatTimelineKind;
	label: string;
	tool?: string;
	arguments?: Record<string, unknown>;
	/** Raw tool_result JSON for evidence rendering. */
	content?: string;
	failed?: boolean;
};

export type ChatDisplayEntry =
	| { role: 'user'; content: string }
	| { role: 'assistant'; variant: 'text'; content: string }
	| { role: 'assistant'; variant: 'thinking'; content: string }
	| ChatTimelineEntry
	| ChatToolCallEntry
	| ChatToolResultEntry;

export type StoredChatStep = {
	content: string;
	metadata: Record<string, unknown>;
};

/** Row shape returned by GET /api/chat/sessions/:id */
export type PersistedChatMessage = {
	role: 'user' | 'assistant' | 'system';
	content: string;
	metadata?: Record<string, unknown> | null;
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

function hasTimelineEntries(entries: ChatDisplayEntry[]): boolean {
	return entries.some((e) => e.role === 'assistant' && e.variant === 'timeline');
}

/** Collapse duplicate tool cards and drop redundant final text after Q&A compose. */
export function normalizeChatDisplay(entries: ChatDisplayEntry[]): ChatDisplayEntry[] {
	if (hasTimelineEntries(entries)) {
		const filtered = entries.filter((entry, i, arr) => {
			if (entry.role !== 'assistant' || entry.variant !== 'timeline' || entry.kind !== 'tool_progress') {
				return true;
			}
			const prev = arr[i - 1];
			return !(
				prev?.role === 'assistant' &&
				prev.variant === 'timeline' &&
				prev.kind === 'tool_progress' &&
				prev.label === entry.label
			);
		});

		const out: ChatDisplayEntry[] = [];
		for (const entry of filtered) {
			const prev = out.at(-1);
			if (
				entry.role === 'assistant' &&
				entry.variant === 'text' &&
				prev?.role === 'assistant' &&
				prev.variant === 'timeline' &&
				prev.kind === 'tool_result' &&
				prev.tool === 'answer_question' &&
				prev.content &&
				normalizeAnswerText(parseFinalAnswerText('', prev.content)) ===
					normalizeAnswerText(entry.content)
			) {
				continue;
			}
			out.push(entry);
		}
		return out;
	}

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
			prev.result &&
			normalizeAnswerText(prev.result) === normalizeAnswerText(entry.content)
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

/** Prefer stored raw tool JSON (same as live stream preview) over displaySummary for evidence UI. */
function toolResultPayloadFromMetadata(
	content: string,
	metadata: Record<string, unknown>
): string {
	const rawContent = content.trim();
	if (rawContent && looksLikeRawToolJson(rawContent)) {
		return rawContent;
	}
	const preview =
		typeof metadata.preview === 'string' ? metadata.preview.trim() : '';
	if (preview && looksLikeRawToolJson(preview)) {
		return preview;
	}
	const result = typeof metadata.result === 'string' ? metadata.result.trim() : '';
	if (result && looksLikeRawToolJson(result)) {
		return result;
	}
	const displaySummary =
		typeof metadata.displaySummary === 'string' ? metadata.displaySummary.trim() : '';
	return displaySummary || rawContent || preview || result;
}

/**
 * Map persisted session rows to the same in-memory timeline shape used while streaming,
 * so reload renders identically to the live client.
 */
export function sessionMessagesToChatEntries(messages: PersistedChatMessage[]): ChatDisplayEntry[] {
	const out: ChatDisplayEntry[] = [];

	for (const m of messages) {
		if (m.role === 'user') {
			out.push({ role: 'user', content: m.content });
			continue;
		}
		if (m.role !== 'assistant') continue;

		const meta = m.metadata ?? {};
		const variant = typeof meta.variant === 'string' ? meta.variant : undefined;

		if (variant === 'thinking') {
			out.push({ role: 'assistant', variant: 'thinking', content: m.content });
			continue;
		}

		const tool = typeof meta.tool === 'string' ? meta.tool : '';
		if (!tool && variant !== undefined && variant !== 'text') {
			// Unknown assistant step — skip empty tool rows rather than showing raw JSON as text.
			if (variant === 'tool_executing' || variant === 'tool_progress') continue;
		}

		if (variant === 'tool_step' && tool) {
			out.push(
				...toolStepToTimelineEntries({
					tool,
					arguments: (meta.arguments as Record<string, unknown>) ?? {},
					content: toolResultPayloadFromMetadata(m.content, meta),
					failed: meta.failed === true
				})
			);
			continue;
		}

		if (variant === 'tool_call' && tool) {
			out.push({
				role: 'assistant',
				variant: 'timeline',
				kind: 'tool_call',
				tool,
				label: `Tool call · ${tool}`,
				arguments: (meta.arguments as Record<string, unknown>) ?? {}
			});
			const legacyResult = toolResultPayloadFromMetadata('', meta);
			if (legacyResult) {
				out.push({
					role: 'assistant',
					variant: 'timeline',
					kind: 'tool_result',
					tool,
					label: `Tool result · ${tool}`,
					content: legacyResult,
					failed: meta.status === 'error' || meta.failed === true
				});
			}
			continue;
		}

		if (variant === 'tool_executing' && tool) {
			out.push({
				role: 'assistant',
				variant: 'timeline',
				kind: 'tool_executing',
				tool,
				label: `Executing tool · ${tool}`
			});
			continue;
		}

		if (variant === 'tool_progress' && tool) {
			const label =
				(typeof meta.label === 'string' && meta.label.trim()) || m.content.trim() || 'Working…';
			out.push({
				role: 'assistant',
				variant: 'timeline',
				kind: 'tool_progress',
				tool,
				label
			});
			continue;
		}

		if (variant === 'tool_result' && tool) {
			out.push({
				role: 'assistant',
				variant: 'timeline',
				kind: 'tool_result',
				tool,
				label: `Tool result · ${tool}`,
				content: toolResultPayloadFromMetadata(m.content, meta),
				failed: meta.failed === true
			});
			continue;
		}

		out.push({ role: 'assistant', variant: 'text', content: m.content });
	}

	return out;
}

/** Expand persisted tool_step into transparent timeline rows for reload. */
export function toolStepToTimelineEntries(input: {
	tool: string;
	arguments?: Record<string, unknown>;
	content: string;
	failed?: boolean;
}): ChatTimelineEntry[] {
	const tool = input.tool;
	return [
		{
			role: 'assistant',
			variant: 'timeline',
			kind: 'tool_call',
			tool,
			label: `Tool call · ${tool}`,
			arguments: input.arguments ?? {}
		},
		{
			role: 'assistant',
			variant: 'timeline',
			kind: 'tool_executing',
			tool,
			label: `Executing tool · ${tool}`
		},
		{
			role: 'assistant',
			variant: 'timeline',
			kind: 'tool_result',
			tool,
			label: `Tool result · ${tool}`,
			content: input.content,
			failed: input.failed === true
		}
	];
}
