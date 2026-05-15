/**
 * Cue bundle extraction.
 *
 * Generates 3–5 alternative search phrases for a thought — "how might this
 * user search for this in 3 months, having forgotten the exact wording?"
 *
 * These cues are stored in `thought.cues text[]` and indexed with GIN so they
 * participate in the existing lexical search pipeline without any changes to
 * the retrieval architecture. When `buildLexicalTsQuery` OR-joins tokens, cue
 * terms are already present in the search surface, broadening recall for
 * reformulated queries.
 *
 * Examples:
 *   Input:  "Met with Anna, she pushed back hard on the Q3 pricing proposal"
 *   Cues:   ["Anna pricing disagreement", "Q3 product meeting", "pricing
 *             pushback", "Anna product decision", "quarterly pricing conflict"]
 */

import { llmChatCompletion } from '$lib/server/llm/llm-client';

const MAX_CUES = 5;
const MIN_CUE_LENGTH = 3;
const MAX_CUE_LENGTH = 80;

/**
 * Returns 3–5 cue phrases for a thought.
 * Returns an empty array on failure — callers should handle gracefully.
 */
export async function extractCues(input: {
	userId: string;
	normalizedText: string;
}): Promise<string[]> {
	const prompt = [
		'Generate 3 to 5 short search phrases (2–8 words each) that capture different ways',
		'a person might search for this memory note in the future.',
		'Think about synonyms, related concepts, key people/places, and emotional context.',
		'Return ONLY a JSON array of strings, no other text.',
		'Example: ["Anna pricing meeting", "Q3 budget pushback", "product pricing conflict"]',
		'',
		`Note: ${input.normalizedText}`
	].join('\n');

	const response = await llmChatCompletion({
		userId: input.userId,
		messages: [
			{
				role: 'system',
				content: 'You generate search cues for personal memory notes. Return only a JSON array of strings.'
			},
			{ role: 'user', content: prompt }
		],
		temperature: 0.3
	});

	const choices = (response as { choices?: unknown }).choices;
	if (!Array.isArray(choices) || choices.length === 0) return [];

	const content = (choices[0] as { message?: { content?: unknown } }).message?.content;
	if (typeof content !== 'string') return [];

	let parsed: unknown;
	try {
		// Strip markdown code fences if present
		const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
		parsed = JSON.parse(cleaned);
	} catch {
		return [];
	}

	if (!Array.isArray(parsed)) return [];

	return parsed
		.filter((item): item is string => typeof item === 'string')
		.map((s) => s.trim())
		.filter((s) => s.length >= MIN_CUE_LENGTH && s.length <= MAX_CUE_LENGTH)
		.slice(0, MAX_CUES);
}
