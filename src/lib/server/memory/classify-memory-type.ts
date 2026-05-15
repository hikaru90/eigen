/**
 * Memory type classification.
 *
 * Classifies a captured thought into one of seven structured memory types:
 *
 *   episode    — a specific event or experience ("Met with Anna, she pushed back")
 *   fact       — a standing truth or reference ("Anna is head of product at X")
 *   decision   — a committed choice ("We decided to go with option B")
 *   concern    — a worry or risk ("I'm worried the contract is at risk")
 *   open_loop  — an unresolved action or question ("Need to follow up with Marcus")
 *   preference — a personal tendency ("I work better in the morning")
 *   pattern    — a recurring observation ("Whenever stressed I defer decisions")
 *
 * The type is used by:
 *   - consolidation jobs (facts can merge; episodes shouldn't)
 *   - retrieval weighting (open loops boost salience until resolved)
 *   - community summary prompts (open loops surfaced in dedicated view)
 */

import { llmChatCompletion } from '$lib/server/llm/llm-client';
import type { MemoryType } from '$lib/server/db/brain.schema';

const VALID_MEMORY_TYPES: MemoryType[] = [
	'episode',
	'fact',
	'decision',
	'concern',
	'open_loop',
	'preference',
	'pattern'
];

function isMemoryType(value: unknown): value is MemoryType {
	return typeof value === 'string' && (VALID_MEMORY_TYPES as string[]).includes(value);
}

/**
 * Returns the memory type for a thought.
 * Throws if the LLM call fails or returns an invalid type — callers should catch.
 */
export async function classifyMemoryType(input: {
	userId: string;
	normalizedText: string;
}): Promise<MemoryType> {
	const prompt = [
		'Classify this personal memory note into exactly one of these types:',
		'  episode    — a specific event or experience that happened',
		'  fact       — a standing truth, reference, or factual note',
		'  decision   — a committed choice or resolution',
		'  concern    — a worry, risk, or anxiety',
		'  open_loop  — an unresolved action item, question, or follow-up',
		'  preference — a personal tendency, habit, or like/dislike',
		'  pattern    — a recurring observation about oneself or a situation',
		'',
		'Return ONLY the single type key, no other text.',
		'',
		`Note: ${input.normalizedText}`
	].join('\n');

	const response = await llmChatCompletion({
		userId: input.userId,
		messages: [
			{
				role: 'system',
				content: 'You classify personal memory notes. Return only the type key, nothing else.'
			},
			{ role: 'user', content: prompt }
		],
		temperature: 0
	});

	const choices = (response as { choices?: unknown }).choices;
	if (!Array.isArray(choices) || choices.length === 0) {
		throw new Error('classifyMemoryType: no choices in response');
	}
	const content = (choices[0] as { message?: { content?: unknown } }).message?.content;
	if (typeof content !== 'string') {
		throw new Error('classifyMemoryType: content is not a string');
	}

	const raw = content.trim().toLowerCase();
	if (!isMemoryType(raw)) {
		throw new Error(`classifyMemoryType: unexpected type "${raw}"`);
	}
	return raw;
}
