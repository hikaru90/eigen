import { eq } from 'drizzle-orm';
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client';
import { getDb } from '$lib/server/db';
import { userOntology } from '$lib/server/db/schema';
import { loadOntologyForUser, validateEntityKindKeyForNewIngest } from '$lib/server/ontology-db';
import { ontologyKindsPromptBlock, parseOntologyProfileJson } from './types';
import { extractChatContent, userMessage } from './llm-json';

export type ResolvedThoughtOntologyKind = {
	/** Same as `thought.category` and `ontology_entity_kind.key`. */
	key: string;
	ontologyEntityKindId: string;
};

async function loadUserOntologyProfileRow(userId: string) {
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
}): Promise<ResolvedThoughtOntologyKind> {
	const runStart = Date.now();
	const userShort = input.userId.length > 8 ? `${input.userId.slice(0, 8)}…` : input.userId;
	console.info('[capture.ontology] classify start', {
		userId: userShort,
		normalizedChars: input.normalized.length,
		rawChars: input.rawText.length
	});

	const tLoad = Date.now();
	const loaded = await loadOntologyForUser(getDb(), input.userId);
	const activeKinds = loaded.entityKinds.filter((k) => k.active);
	if (activeKinds.length === 0) {
		throw new Error('No active ontology entity kinds for user; cannot classify capture.');
	}
	const kindKeys = [...new Set(activeKinds.map((k) => k.key))].sort();
	console.info('[capture.ontology] catalog loaded', {
		ms: Date.now() - tLoad,
		activeKindCount: activeKinds.length,
		kindKeys
	});

	const tProfile = Date.now();
	const profile = await loadUserOntologyProfileRow(input.userId);
	console.info('[capture.ontology] user ontology profile row loaded', { ms: Date.now() - tProfile });

	const ontologyBlock = ontologyKindsPromptBlock(activeKinds, profile);
	const allowedList = [...new Set(activeKinds.map((k) => k.key))].sort().join(', ');

	const prompt = [
		'Return ONLY JSON with a single key "category".',
		`The value must be exactly one of these ontology entity kind keys: ${allowedList}.`,
		'Pick the single best-matching kind for the capture text using the definitions below.',
		`Kinds:\n${ontologyBlock}`,
		`Normalized text:\n${input.normalized}`,
		`Original raw text:\n${input.rawText}`
	].join('\n');

	const messages: ChatMessage[] = [
		{
			role: 'system',
			content:
				'You assign exactly one ontology entity kind key per capture for a personal memory system. Output JSON only.'
		},
		userMessage(prompt)
	];

	const tLlm = Date.now();
	console.info('[capture.ontology] calling LLM for category (chat completion)', {
		promptChars: prompt.length,
		systemChars: messages[0]?.content.length ?? 0
	});
	const response = await llmChatCompletion({
		userId: input.userId,
		messages,
		temperature: 0,
		logContext: 'thought_category'
	});
	console.info('[capture.ontology] LLM returned for category', { llmMs: Date.now() - tLlm });

	const content = extractChatContent(response).trim();
	const parsed = JSON.parse(content) as unknown;
	if (!parsed || typeof parsed !== 'object') {
		throw new Error('Category classification output must be a JSON object');
	}
	const cat = (parsed as { category?: unknown }).category;
	if (typeof cat !== 'string') {
		throw new Error('Category classification output has invalid category');
	}
	const trimmed = cat.trim();
	if (!validateEntityKindKeyForNewIngest(loaded, trimmed)) {
		throw new Error(`Category classification returned invalid ontology key: ${trimmed}`);
	}
	const row = loaded.entityKindsByKey.get(trimmed);
	if (!row) {
		throw new Error(`Missing ontology row for validated key: ${trimmed}`);
	}
	console.info('[capture.ontology] classify done', {
		key: row.key,
		totalMs: Date.now() - runStart
	});
	return { key: row.key, ontologyEntityKindId: row.id };
}
