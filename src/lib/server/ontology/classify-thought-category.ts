import { eq } from 'drizzle-orm';
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client';
import { getDb } from '$lib/server/db';
import { userOntology, type ThoughtCategory } from '$lib/server/db/schema';
import { parseOntologyProfileJson, profileToPromptBlock, isThoughtCategory } from './types';
import { extractChatContent, userMessage } from './llm-json';

async function loadUserOntologyProfile(userId: string) {
	const [row] = await getDb()
		.select({ profile: userOntology.profile })
		.from(userOntology)
		.where(eq(userOntology.userId, userId))
		.limit(1);
	return row?.profile ? parseOntologyProfileJson(row.profile) : parseOntologyProfileJson({});
}

export async function resolveThoughtCategory(input: {
	userId: string;
	normalized: string;
	rawText: string;
}): Promise<ThoughtCategory> {
	const profile = await loadUserOntologyProfile(input.userId);
	const ontologyBlock = profileToPromptBlock(profile);

	const categories =
		'thought, task, idea, reference, date, person — choose exactly one. ' +
		'Definitions: thought=general note; task=action item or obligation; idea=creative or proposal; ' +
		'reference=pointer to external material; date=time or schedule anchor; person=about a specific human.';

	const prompt = [
		'Return ONLY JSON with a single key "category".',
		`Allowed category values: ${categories}`,
		'Use the user-specific ontology notes below when they help disambiguate.',
		`Ontology notes:\n${ontologyBlock}`,
		`Normalized text:\n${input.normalized}`,
		`Original raw text:\n${input.rawText}`
	].join('\n');

	const messages: ChatMessage[] = [
		{
			role: 'system',
			content:
				'You assign exactly one baseline category per capture for a personal memory system. Output JSON only.'
		},
		userMessage(prompt)
	];

	const response = await llmChatCompletion({
		userId: input.userId,
		messages,
		temperature: 0
	});

	const content = extractChatContent(response).trim();
	const parsed = JSON.parse(content) as unknown;
	if (!parsed || typeof parsed !== 'object') {
		throw new Error('Category classification output must be a JSON object');
	}
	const cat = (parsed as { category?: unknown }).category;
	if (typeof cat !== 'string' || !isThoughtCategory(cat.trim())) {
		throw new Error('Category classification output has invalid category');
	}
	return cat.trim() as ThoughtCategory;
}
