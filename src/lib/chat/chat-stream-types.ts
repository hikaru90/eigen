export type ChatStreamEvent =
	| { type: 'thinking'; content: string }
	| { type: 'tool_call'; tool: string; arguments: Record<string, unknown> }
	| { type: 'tool_result'; tool: string; preview: string; failed?: boolean }
	| { type: 'done'; response: string; sessionId: string; messageId: string }
	| { type: 'error'; error: string; details?: string[] };

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

export function toolCategoryClasses(category: ChatToolCategory): {
	border: string;
	badge: string;
	icon: string;
} {
	switch (category) {
		case 'search':
			return {
				border: 'border-sky-500/35 dark:border-sky-400/30',
				badge: 'bg-sky-500/10 text-sky-800 dark:text-sky-200',
				icon: 'text-sky-700 dark:text-sky-300'
			};
		case 'compose':
			return {
				border: 'border-violet-500/35 dark:border-violet-400/30',
				badge: 'bg-violet-500/10 text-violet-800 dark:text-violet-200',
				icon: 'text-violet-700 dark:text-violet-300'
			};
		case 'write':
			return {
				border: 'border-emerald-500/35 dark:border-emerald-400/30',
				badge: 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-200',
				icon: 'text-emerald-700 dark:text-emerald-300'
			};
		case 'destructive':
			return {
				border: 'border-rose-500/35 dark:border-rose-400/30',
				badge: 'bg-rose-500/10 text-rose-800 dark:text-rose-200',
				icon: 'text-rose-700 dark:text-rose-300'
			};
		case 'memory':
		default:
			return {
				border: 'border-amber-500/35 dark:border-amber-400/30',
				badge: 'bg-amber-500/10 text-amber-900 dark:text-amber-100',
				icon: 'text-amber-800 dark:text-amber-200'
			};
	}
}

export function toolStatusBadgeClasses(status: 'running' | 'done' | 'failed'): string {
	switch (status) {
		case 'running':
			return 'bg-muted text-muted-foreground';
		case 'failed':
			return 'bg-rose-500/15 text-rose-800 dark:text-rose-200';
		case 'done':
		default:
			return 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-200';
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

export function formatToolResultForDisplay(tool: string, preview: string): string {
	let parsed: Record<string, unknown> | undefined;
	try {
		const p = JSON.parse(preview);
		if (p && typeof p === 'object') parsed = p as Record<string, unknown>;
	} catch {
		// use raw preview
	}

	if (parsed && typeof parsed.error === 'string') {
		return `Error: ${parsed.error}`;
	}

	if (tool === 'capture_thought' && parsed?.thought && typeof parsed.thought === 'object') {
		const t = parsed.thought as { normalizedText?: string; category?: string };
		const cat = t.category ? ` (${t.category})` : '';
		return `Saved${cat}: ${t.normalizedText ?? '(no text)'}`;
	}

	if (tool === 'edit_thought') {
		const summary = typeof parsed?.summary === 'string' ? parsed.summary : null;
		const thoughtId = typeof parsed?.thoughtId === 'string' ? parsed.thoughtId : null;
		const before = parsed?.before as { normalizedText?: string; status?: string } | undefined;
		const after = parsed?.after as { normalizedText?: string; status?: string } | undefined;
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
		} else if (parsed?.thought && typeof parsed.thought === 'object') {
			const t = parsed.thought as { normalizedText?: string; category?: string };
			lines.push(`Updated: ${t.normalizedText ?? '(no text)'}`);
		}
		if (lines.length > 0) return lines.join('\n');
	}

	if (tool === 'delete_thought') {
		const thoughtId = typeof parsed?.thoughtId === 'string' ? parsed.thoughtId : null;
		if (parsed?.deleted && thoughtId) {
			return `Deleted thought ${thoughtId.slice(0, 8)}…`;
		}
		return parsed?.deleted ? 'Thought deleted.' : preview;
	}

	const results = parsed?.results;
	if (Array.isArray(results)) {
		return results
			.map((r: { normalizedText?: string }, i: number) => `${i + 1}. ${r.normalizedText ?? '(no text)'}`)
			.join('\n');
	}

	const thoughts = parsed?.thoughts;
	if (Array.isArray(thoughts)) {
		return thoughts
			.map(
				(t: { id?: string; normalizedText?: string; category?: string }, i: number) =>
					`${i + 1}. [${t.id?.slice(0, 8) ?? '?'}] ${t.category ?? ''}: ${t.normalizedText ?? '(no text)'}`
			)
			.join('\n');
	}

	if (typeof parsed?.answer === 'string') {
		return parsed.answer;
	}

	return preview.length > 500 ? `${preview.slice(0, 500)}...` : preview;
}
