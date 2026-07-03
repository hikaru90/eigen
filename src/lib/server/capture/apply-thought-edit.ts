import { truncateEditPreview } from '$lib/server/capture/edit-phase-timing';
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client';
import { extractChatContent } from '$lib/server/ontology/llm-json';
import {
	lifecycleStatusEnum,
	type LifecycleStatus
} from '$lib/server/db/brain.schema';

/** @deprecated Use LifecycleStatus from brain.schema */
export type ThoughtLifecycleStatus = LifecycleStatus;

const LIFECYCLE_COMPLETE_COMMANDS = [
	'mark as completed',
	'mark as complete',
	'mark complete',
	'mark as done'
] as const;

const LIFECYCLE_OPEN_COMMANDS = ['reopen', 'mark as open'] as const;

const LIFECYCLE_ARCHIVE_COMMANDS = [
	'archive',
	'mark as archived',
	'dismiss',
	'not relevant',
	'remove from active'
] as const;

/**
 * Recognize explicit lifecycle edit commands (MCP/UI protocol).
 * Not semantic classification of thought content — only routes known status verbs.
 */
export function parseLifecycleEditRequest(editRequest: string): LifecycleStatus | null {
	const trimmed = editRequest.trim();
	if (!trimmed) return null;
	const lower = trimmed.toLowerCase();

	for (const command of LIFECYCLE_COMPLETE_COMMANDS) {
		if (lower === command || lower.startsWith(`${command} `) || lower.startsWith(`${command}—`) || lower.startsWith(`${command}-`)) {
			return 'completed';
		}
	}
	for (const command of LIFECYCLE_OPEN_COMMANDS) {
		if (lower === command || lower.startsWith(`${command} `)) {
			return 'open';
		}
	}
	for (const command of LIFECYCLE_ARCHIVE_COMMANDS) {
		if (lower === command || lower.startsWith(`${command} `)) {
			return 'archived';
		}
	}
	return null;
}

export type AppliedThoughtEdit = {
	rawText: string;
	/** When set, merged into thought.metadata.status */
	status?: LifecycleStatus | null;
	/** Short description of what changed (for chat traceability). */
	summary: string;
};

function parseAppliedEditJson(text: string, fallbackRaw: string): AppliedThoughtEdit {
	let trimmed = text.trim();
	const fence = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)```\s*$/);
	if (fence) trimmed = fence[1].trim();

	const parsed = JSON.parse(trimmed) as Record<string, unknown>;
	const rawText = typeof parsed.rawText === 'string' ? parsed.rawText.trim() : fallbackRaw;
	if (!rawText) {
		throw new Error('LLM edit response missing non-empty rawText');
	}
	let status: LifecycleStatus | null | undefined;
	if (lifecycleStatusEnum.includes(parsed.status as LifecycleStatus)) {
		status = parsed.status as LifecycleStatus;
	} else if (parsed.status === null) {
		status = null;
	}

	const summary =
		typeof parsed.summary === 'string' && parsed.summary.trim()
			? parsed.summary.trim()
			: 'Thought updated.';

	return { rawText, status, summary };
}

/**
 * Resolve a natural-language edit request against existing thought text.
 * Completion-only requests preserve body text and set metadata.status.
 */
export async function applyThoughtEditRequest(input: {
	userId: string;
	existingRawText: string;
	existingNormalizedText: string;
	category: string;
	editRequest: string;
}): Promise<AppliedThoughtEdit> {
	const editRequest = input.editRequest.trim();
	if (!editRequest) {
		throw new Error('editRequest is required');
	}

	console.info('[capture.edit.llm] request', {
		userId: input.userId,
		category: input.category,
		editRequestPreview: truncateEditPreview(editRequest),
		existingRawLen: input.existingRawText.length
	});

	const messages: ChatMessage[] = [
		{
			role: 'system',
			content: [
				'You apply a natural-language edit to a stored personal thought.',
				'Return JSON only:',
				`{ "rawText": "<full updated thought body>", "status": ${lifecycleStatusEnum.map((s) => `"${s}"`).join(' | ')} | null, "summary": "<one sentence: what changed>" }`,
				'Rules:',
				'- rawText must be the complete updated thought, not the edit instruction alone.',
				'- When marking complete, keep the original meaning; set status to "completed" unless the user also rewrites the text.',
				'- When archiving or dismissing as not relevant, set status to "archived".',
				'- Do not invent facts beyond the edit request.',
				'- summary must name the concrete change (e.g. marked complete, fixed typo, shortened).'
			].join('\n')
		},
		{
			role: 'user',
			content: [
				`Category: ${input.category}`,
				`Current text:\n${input.existingRawText}`,
				`Edit request: ${editRequest}`
			].join('\n\n')
		}
	];

	const response = await llmChatCompletion({
		userId: input.userId,
		messages,
		temperature: 0,
		logContext: 'apply_thought_edit'
	});

	const content = extractChatContent(response);
	try {
		const parsed = parseAppliedEditJson(content, input.existingRawText);
		console.info('[capture.edit.llm] parsed', {
			userId: input.userId,
			status: parsed.status ?? null,
			summary: parsed.summary,
			rawTextLen: parsed.rawText.length,
			textUnchanged: parsed.rawText === input.existingRawText
		});
		return parsed;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('[capture.edit.llm] parse failed', {
			userId: input.userId,
			message,
			responsePreview: truncateEditPreview(content, 400)
		});
		throw new Error(`Failed to parse thought edit LLM response: ${message}`);
	}
}
