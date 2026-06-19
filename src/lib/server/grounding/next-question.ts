import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client';
import { stripMarkdownJsonFences } from '$lib/server/memory/llm-json-content';
import {
	GROUNDING_FACET_KEY_SET,
	GROUNDING_FACET_KEYS,
	type GroundingFacetKey
} from '$lib/server/grounding/constants';
import { loadGroundingProfileRow } from '$lib/server/grounding/profile';
import { loadRecentThoughtsForGroundingQuestion } from '$lib/server/grounding/question-due';

export type GroundingQuestion = {
	facetKey: GroundingFacetKey;
	question: string;
};

function parseNextQuestionOutput(raw: string): GroundingQuestion | null {
	const trimmed = stripMarkdownJsonFences(raw.trim());
	const parsed = JSON.parse(trimmed) as unknown;
	if (!parsed || typeof parsed !== 'object') return null;
	const o = parsed as Record<string, unknown>;
	if (o.skip === true) return null;
	const facetKey = typeof o.facetKey === 'string' ? o.facetKey.trim() : '';
	const question = typeof o.question === 'string' ? o.question.trim() : '';
	if (!GROUNDING_FACET_KEY_SET.has(facetKey) || question.length === 0) return null;
	return { facetKey: facetKey as GroundingFacetKey, question };
}

export async function generateGroundingQuestion(userId: string): Promise<GroundingQuestion | null> {
	const [recentThoughts, profile] = await Promise.all([
		loadRecentThoughtsForGroundingQuestion(userId),
		loadGroundingProfileRow(userId)
	]);

	const filledFacets = Object.keys(profile?.facets ?? {});
	const thoughtLines =
		recentThoughts.length > 0
			? recentThoughts.map((t, i) => `${i + 1}. [${t.category}] ${t.normalizedText}`)
			: ['(none yet)'];

	const prompt = [
		'Return ONLY JSON with one of these shapes:',
		'{"facetKey": "<key>", "question": "<single warm question>"}',
		'{"skip": true}',
		'',
		`facetKey must be one of: ${GROUNDING_FACET_KEYS.join(', ')}.`,
		'Pick a facet area that would most help classify and enrich future captures for this user.',
		'Prefer gaps in self-knowledge over facets already well covered.',
		'Ask exactly one concise, optional-feeling question — not a form or interview.',
		'Base the question on patterns or gaps visible in their recent captures.',
		'If recent captures give no useful angle, return {"skip": true}.',
		'',
		`Already captured facet keys: ${filledFacets.length > 0 ? filledFacets.join(', ') : '(none)'}`,
		'Recent captures (most recent first):',
		thoughtLines.join('\n')
	].join('\n');

	const messages: ChatMessage[] = [
		{
			role: 'system',
			content:
				'You propose one optional getting-to-know-you question for a personal memory app. JSON only.'
		},
		{ role: 'user', content: prompt }
	];

	const response = await llmChatCompletion({
		userId,
		messages,
		temperature: 0.3,
		logContext: 'grounding_next_question'
	});

	const content = (response as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]
		?.message?.content;
	if (typeof content !== 'string') {
		throw new Error('generateGroundingQuestion: missing LLM content');
	}

	try {
		return parseNextQuestionOutput(content);
	} catch {
		return null;
	}
}
