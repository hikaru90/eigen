import { llmChatCompletion } from '$lib/server/llm/llm-client';
import type { ChatMessage } from '$lib/server/llm/llm-client';
import {
	GROUNDING_FACET_KEYS,
	GROUNDING_NARRATIVE_MAX_CHARS
} from '$lib/server/grounding/constants';

function extractChatContent(response: unknown): string {
	const r = response as { choices?: Array<{ message?: { content?: string } }> };
	return r?.choices?.[0]?.message?.content?.trim() ?? '';
}

function parseNarrativeJson(raw: string): string {
	let trimmed = raw.trim();
	const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)```\s*$/);
	if (fenceMatch) trimmed = fenceMatch[1].trim();
	try {
		const parsed = JSON.parse(trimmed) as { narrative?: unknown };
		if (typeof parsed.narrative === 'string' && parsed.narrative.trim().length > 0) {
			return parsed.narrative.trim().slice(0, GROUNDING_NARRATIVE_MAX_CHARS);
		}
	} catch {
		// fall through
	}
	if (trimmed.length > 0) {
		return trimmed.slice(0, GROUNDING_NARRATIVE_MAX_CHARS);
	}
	throw new Error('Grounding narrative synthesis returned empty content');
}

/**
 * LLM-synthesized portrait from facet slices and optional session note.
 */
export async function synthesizeGroundingNarrative(input: {
	userId: string;
	facets: Record<string, string>;
	sessionNote?: string;
	priorNarrative?: string;
}): Promise<string> {
	const facetLines = GROUNDING_FACET_KEYS.map((key) => {
		const value = input.facets[key]?.trim();
		return value ? `- ${key}: ${value}` : null;
	}).filter((line): line is string => line !== null);

	const prompt = [
		'Return ONLY JSON: {"narrative": "<string>"}.',
		`narrative must be <= ${GROUNDING_NARRATIVE_MAX_CHARS} characters.`,
		'Write a cohesive second-person portrait of who this user is — work, values, relationships, psychology, routines.',
		'Use only facts from the facets below; do not invent details.',
		input.priorNarrative
			? `Prior narrative (refine and extend, do not contradict):\n${input.priorNarrative}`
			: '',
		'Facet slices:',
		facetLines.length > 0 ? facetLines.join('\n') : '(none yet)',
		input.sessionNote ? `Session note:\n${input.sessionNote}` : ''
	]
		.filter((line) => line.length > 0)
		.join('\n\n');

	const messages: ChatMessage[] = [
		{
			role: 'system',
			content:
				'You synthesize a compact user grounding portrait for a personal memory system. JSON only.'
		},
		{ role: 'user', content: prompt }
	];

	const response = await llmChatCompletion({
		userId: input.userId,
		messages,
		temperature: 0,
		logContext: 'grounding_narrative_synthesis'
	});

	return parseNarrativeJson(extractChatContent(response));
}
