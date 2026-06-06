import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client';
import { extractChatContent } from '$lib/server/ontology/llm-json';

export type ThoughtLifecycleStatus = 'open' | 'completed';

export type AppliedThoughtEdit = {
	rawText: string;
	/** When set, merged into thought.metadata.status */
	status?: ThoughtLifecycleStatus | null;
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
	let status: ThoughtLifecycleStatus | null | undefined;
	if (parsed.status === 'completed') status = 'completed';
	else if (parsed.status === 'open') status = 'open';
	else if (parsed.status === null) status = null;

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

	const messages: ChatMessage[] = [
		{
			role: 'system',
			content: [
				'You apply a natural-language edit to a stored personal thought.',
				'Return JSON only:',
				'{ "rawText": "<full updated thought body>", "status": "open" | "completed" | null, "summary": "<one sentence: what changed>" }',
				'Rules:',
				'- rawText must be the complete updated thought, not the edit instruction alone.',
				'- When marking complete, keep the original meaning; set status to "completed" unless the user also rewrites the text.',
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
		return parseAppliedEditJson(content, input.existingRawText);
	} catch (err) {
		throw new Error(
			`Failed to parse thought edit LLM response: ${err instanceof Error ? err.message : String(err)}`
		);
	}
}
