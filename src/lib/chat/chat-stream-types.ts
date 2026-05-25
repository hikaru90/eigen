export type ChatStreamEvent =
	| { type: 'thinking'; content: string }
	| { type: 'agent_progress'; label: string }
	| { type: 'tool_call'; tool: string; arguments: Record<string, unknown> }
	| { type: 'tool_progress'; tool: string; phase: string; label: string }
	| { type: 'tool_result'; tool: string; preview: string; failed?: boolean }
	| { type: 'done'; response: string; sessionId: string; messageId: string }
	| { type: 'error'; error: string; details?: string[] };

/** In-tool step labels streamed while a tool handler is still running. */
export const CHAT_TOOL_PROGRESS_LABELS: Record<string, Record<string, string>> = {
	answer_question: {
		embedding: 'Embedding your question…',
		searching: 'Searching your memories…',
		composing: 'Composing answer from matches…'
	},
	retrieve_thoughts: {
		searching: 'Searching your memories…'
	}
};

export type ChatToolCategory = 'memory' | 'search' | 'compose' | 'write' | 'destructive';

export type ChatToolIcon = 'save' | 'list' | 'search' | 'sparkles' | 'pencil' | 'trash' | 'bot';

export type ChatToolVisual = {
	title: string;
	category: ChatToolCategory;
	icon: ChatToolIcon;
};

export const CHAT_TOOL_COPY: Record<string, ChatToolVisual> = {
	capture_thought: { title: 'Saving to memory', category: 'write', icon: 'save' },
	list_thoughts: { title: 'Listing thoughts', category: 'memory', icon: 'list' },
	retrieve_thoughts: { title: 'Searching your memories', category: 'search', icon: 'search' },
	answer_question: { title: 'Analyzing and composing answer', category: 'compose', icon: 'sparkles' },
	edit_thought: { title: 'Updating thought', category: 'write', icon: 'pencil' },
	delete_thought: { title: 'Deleting thought', category: 'destructive', icon: 'trash' }
};

const UNKNOWN_TOOL_VISUAL: ChatToolVisual = {
	title: 'Running tool',
	category: 'memory',
	icon: 'bot'
};

export function toolVisual(tool: string): ChatToolVisual {
	return CHAT_TOOL_COPY[tool] ?? { ...UNKNOWN_TOOL_VISUAL, title: `Running ${tool}` };
}

export function toolLabel(tool: string): string {
	return toolVisual(tool).title;
}

/** Monochrome tool chrome — category only affects copy/icon choice, not color. */
export function toolCategoryClasses(_category: ChatToolCategory): { icon: string } {
	return { icon: 'text-muted-foreground' };
}

export function toolStatusBadgeClasses(status: 'running' | 'done' | 'failed'): string {
	switch (status) {
		case 'running':
			return 'text-muted-foreground';
		case 'failed':
			return 'text-foreground';
		case 'done':
		default:
			return 'text-muted-foreground';
	}
}

export function formatToolArgumentsSummary(
	tool: string,
	args: Record<string, unknown>
): string | null {
	if (!args || Object.keys(args).length === 0) return null;

	if (tool === 'retrieve_thoughts' || tool === 'answer_question') {
		const q = args.query ?? args.question;
		if (typeof q === 'string' && q.trim()) return q.trim();
	}

	if (tool === 'capture_thought') {
		const raw = args.raw ?? args.text ?? args.content;
		if (typeof raw === 'string' && raw.trim()) {
			const t = raw.trim();
			return t.length > 120 ? `${t.slice(0, 117)}…` : t;
		}
	}

	if (tool === 'edit_thought') {
		const id = args.thoughtId ?? args.id;
		const instruction = args.instruction ?? args.edit ?? args.request;
		const parts: string[] = [];
		if (typeof id === 'string' && id.trim()) parts.push(`Thought ${id.slice(0, 8)}…`);
		if (typeof instruction === 'string' && instruction.trim()) {
			const t = instruction.trim();
			parts.push(t.length > 100 ? `${t.slice(0, 97)}…` : t);
		}
		if (parts.length > 0) return parts.join(' · ');
	}

	if (tool === 'delete_thought') {
		const id = args.thoughtId ?? args.id;
		if (typeof id === 'string' && id.trim()) return `Thought ${id.slice(0, 8)}…`;
	}

	if (tool === 'list_thoughts') {
		const limit = args.limit;
		if (typeof limit === 'number') return `Up to ${limit} thoughts`;
	}

	return null;
}

export function toolArgumentsPreview(args: Record<string, unknown>, maxChars = 2400): string {
	try {
		const s = JSON.stringify(args, null, 2);
		return s.length > maxChars ? `${s.slice(0, maxChars)}\n…` : s;
	} catch {
		return '(arguments could not be serialized)';
	}
}

export function isToolResultFailed(preview: string): boolean {
	try {
		const p = JSON.parse(preview) as { error?: unknown };
		return typeof p?.error === 'string' && p.error.length > 0;
	} catch {
		return preview.toLowerCase().includes('"error"');
	}
}

export type ToolResultMemoryHit = {
	id?: string;
	text: string;
	category?: string;
};

export type ToolResultView =
	| { kind: 'error'; message: string }
	| { kind: 'memories'; hits: ToolResultMemoryHit[] }
	| { kind: 'lines'; lines: string[] }
	| { kind: 'text'; text: string };

function parseToolResultObject(tool: string, parsed: Record<string, unknown>): ToolResultView | null {
	if (typeof parsed.error === 'string' && parsed.error.length > 0) {
		return { kind: 'error', message: parsed.error };
	}

	if (tool === 'capture_thought' && parsed.thought && typeof parsed.thought === 'object') {
		const t = parsed.thought as { normalizedText?: string; category?: string };
		const cat = t.category ? ` (${t.category})` : '';
		return { kind: 'text', text: `Saved${cat}: ${t.normalizedText ?? '(no text)'}` };
	}

	if (tool === 'edit_thought') {
		const summary = typeof parsed.summary === 'string' ? parsed.summary : null;
		const thoughtId = typeof parsed.thoughtId === 'string' ? parsed.thoughtId : null;
		const before = parsed.before as { normalizedText?: string; status?: string } | undefined;
		const after = parsed.after as { normalizedText?: string; status?: string } | undefined;
		const lines: string[] = [];
		if (thoughtId) lines.push(`Thought ${thoughtId.slice(0, 8)}…`);
		if (summary) lines.push(summary);
		if (before && after) {
			if (before.normalizedText !== after.normalizedText) {
				lines.push(`Before: ${before.normalizedText ?? '(no text)'}`);
				lines.push(`After: ${after.normalizedText ?? '(no text)'}`);
			}
			if (before.status !== after.status) {
				lines.push(`Status: ${before.status ?? 'open'} → ${after.status ?? 'open'}`);
			}
		} else if (parsed.thought && typeof parsed.thought === 'object') {
			const t = parsed.thought as { normalizedText?: string };
			lines.push(`Updated: ${t.normalizedText ?? '(no text)'}`);
		}
		if (lines.length > 0) return { kind: 'lines', lines };
	}

	if (tool === 'delete_thought') {
		const thoughtId = typeof parsed.thoughtId === 'string' ? parsed.thoughtId : null;
		if (parsed.deleted && thoughtId) {
			return { kind: 'text', text: `Deleted thought ${thoughtId.slice(0, 8)}…` };
		}
		if (parsed.deleted) return { kind: 'text', text: 'Thought deleted.' };
	}

	const memoryHits = memoryHitsFromPayload(parsed);
	if (memoryHits) return memoryHits;

	if (typeof parsed.answer === 'string' && parsed.answer.trim()) {
		return { kind: 'text', text: parsed.answer.trim() };
	}

	return null;
}

function memoryHitsFromPayload(parsed: Record<string, unknown>): ToolResultView | null {
	const sources = [parsed.results, parsed.retrieved, parsed.thoughts].find(Array.isArray);
	if (!Array.isArray(sources)) return null;

	const hits: ToolResultMemoryHit[] = sources
		.map((row) => {
			if (!row || typeof row !== 'object') return null;
			const r = row as Record<string, unknown>;
			const text =
				typeof r.normalizedText === 'string'
					? r.normalizedText
					: typeof r.text === 'string'
						? r.text
						: '';
			if (!text.trim()) return null;
			return {
				id: typeof r.id === 'string' ? r.id : undefined,
				text: text.trim(),
				category: typeof r.category === 'string' ? r.category : undefined
			};
		})
		.filter((h): h is ToolResultMemoryHit => h !== null);

	return { kind: 'memories', hits };
}

/** Normalize jsonb metadata values and legacy persisted tool payloads to a string. */
export function coerceToolResultSource(value: unknown): string | undefined {
	if (typeof value === 'string') {
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : undefined;
	}
	if (value && typeof value === 'object') {
		try {
			return JSON.stringify(value);
		} catch {
			return undefined;
		}
	}
	return undefined;
}

function salvageMemoryHitsFromBrokenJson(source: string): ToolResultMemoryHit[] {
	const hits: ToolResultMemoryHit[] = [];
	const textRe = /"normalizedText"\s*:\s*"((?:\\.|[^"\\])*)"/g;
	const categoryRe = /"category"\s*:\s*"((?:\\.|[^"\\])*)"/g;
	let textMatch: RegExpExecArray | null;
	const categories: string[] = [];
	let catMatch: RegExpExecArray | null;
	while ((catMatch = categoryRe.exec(source)) !== null) {
		try {
			categories.push(JSON.parse(`"${catMatch[1]}"`));
		} catch {
			categories.push(catMatch[1]);
		}
	}
	let i = 0;
	while ((textMatch = textRe.exec(source)) !== null) {
		let text: string;
		try {
			text = JSON.parse(`"${textMatch[1]}"`);
		} catch {
			text = textMatch[1];
		}
		if (text.trim()) {
			hits.push({
				text: text.trim(),
				category: categories[i]
			});
		}
		i += 1;
	}
	return hits;
}

function decodeToolResultPayload(source: string): Record<string, unknown> | null {
	const trimmed = source.trim();
	if (!trimmed) return null;

	const attempts = [trimmed];
	if (trimmed.startsWith('"')) attempts.push(trimmed);

	for (const attempt of attempts) {
		try {
			let parsed: unknown = JSON.parse(attempt);
			if (typeof parsed === 'string') {
				try {
					parsed = JSON.parse(parsed);
				} catch {
					continue;
				}
			}
			if (Array.isArray(parsed)) {
				return { results: parsed };
			}
			if (parsed && typeof parsed === 'object') {
				const obj = parsed as Record<string, unknown>;
				if (obj.result && typeof obj.result === 'object' && !Array.isArray(obj.result)) {
					return obj.result as Record<string, unknown>;
				}
				if (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
					return obj.data as Record<string, unknown>;
				}
				return obj;
			}
		} catch {
			// try next attempt
		}
	}

	const salvaged = salvageMemoryHitsFromBrokenJson(trimmed);
	if (salvaged.length > 0) {
		return {
			results: salvaged.map((h) => ({
				id: h.id,
				normalizedText: h.text,
				category: h.category
			}))
		};
	}

	return null;
}

export function looksLikeRawToolJson(value: string): boolean {
	const trimmed = value.trim();
	return trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"');
}

export function parseToolResultPreview(tool: string, preview: string): ToolResultView | null {
	const parsed = decodeToolResultPayload(preview);
	if (!parsed) return null;
	return parseToolResultObject(tool, parsed);
}

export function toolResultViewToText(view: ToolResultView): string {
	switch (view.kind) {
		case 'error':
			return `Error: ${view.message}`;
		case 'memories':
			if (view.hits.length === 0) return 'No matching memories.';
			return view.hits.map((h, i) => `${i + 1}. ${h.text}`).join('\n');
		case 'lines':
			return view.lines.join('\n');
		case 'text':
			return view.text;
	}
}

export function resolveToolResultView(
	tool: string,
	rawContent: string,
	displaySummary?: string
): ToolResultView {
	const raw = coerceToolResultSource(rawContent) ?? '';
	const summary = coerceToolResultSource(displaySummary);

	for (const source of [raw, summary]) {
		if (!source) continue;
		const view = parseToolResultPreview(tool, source);
		if (view) return view;
	}

	if (summary && !looksLikeRawToolJson(summary)) {
		return { kind: 'text', text: summary };
	}

	const fromRaw = parseToolResultPreview(tool, raw);
	if (fromRaw) return fromRaw;

	if (looksLikeRawToolJson(raw) || (summary && looksLikeRawToolJson(summary))) {
		return { kind: 'text', text: 'Could not read stored results for this step.' };
	}

	return { kind: 'text', text: formatToolResultForDisplay(tool, raw) };
}

export function resolveToolResultText(
	tool: string,
	rawContent: string,
	displaySummary?: string
): string {
	return toolResultViewToText(resolveToolResultView(tool, rawContent, displaySummary));
}

export function formatToolResultForDisplay(tool: string, preview: string): string {
	const view = parseToolResultPreview(tool, preview);
	if (view) return toolResultViewToText(view);
	return preview.length > 500 ? `${preview.slice(0, 500)}...` : preview;
}
