import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client';

export type ExtractedEntityMention = {
	surface: string;
	entityType: string;
	confidence: number;
};

export type ExtractedEntityTriple = {
	subject: string;
	object: string;
	predicate: string;
	confidence: number;
};

const ALLOWED_ENTITY_TYPES = new Set([
	'person',
	'org',
	'place',
	'topic',
	'product',
	'other'
]);

const ALLOWED_ENTITY_PREDICATES = new Set([
	'related_to',
	'depends_on',
	'part_of',
	'located_in',
	'knows',
	'works_at'
]);

function extractChatContent(response: unknown): string {
	if (!response || typeof response !== 'object') {
		throw new Error('Entity extraction response is not an object');
	}
	const choices = (response as { choices?: unknown }).choices;
	if (!Array.isArray(choices) || choices.length === 0) {
		throw new Error('Entity extraction response has no choices');
	}
	const message = (choices[0] as { message?: unknown }).message;
	if (!message || typeof message !== 'object') {
		throw new Error('Entity extraction response has no message');
	}
	const content = (message as { content?: unknown }).content;
	if (typeof content !== 'string') {
		throw new Error('Entity extraction message content must be a string');
	}
	return content;
}

function clampConfidence(value: unknown): number {
	if (typeof value !== 'number' || Number.isNaN(value)) return 0;
	return Math.min(1, Math.max(0, value));
}

export function parseEntityMentions(content: string): ExtractedEntityMention[] {
	const parsed = JSON.parse(content) as unknown;
	if (!Array.isArray(parsed)) {
		throw new Error('Entity extraction output must be a JSON array');
	}
	return parsed
		.map((entry) => {
			if (!entry || typeof entry !== 'object') return null;
			const surface =
				typeof (entry as { surface?: unknown }).surface === 'string'
					? (entry as { surface: string }).surface.trim()
					: '';
			const entityType =
				typeof (entry as { entityType?: unknown }).entityType === 'string'
					? (entry as { entityType: string }).entityType.trim()
					: '';
			const confidence = clampConfidence((entry as { confidence?: unknown }).confidence);
			if (!surface || !ALLOWED_ENTITY_TYPES.has(entityType)) return null;
			return { surface, entityType, confidence };
		})
		.filter((v): v is ExtractedEntityMention => v !== null);
}

export function parseEntityTriples(
	content: string,
	allowedSurfaces: Set<string>
): ExtractedEntityTriple[] {
	const parsed = JSON.parse(content) as unknown;
	if (!Array.isArray(parsed)) {
		throw new Error('Entity relation extraction output must be a JSON array');
	}
	return parsed
		.map((entry) => {
			if (!entry || typeof entry !== 'object') return null;
			const subject =
				typeof (entry as { subject?: unknown }).subject === 'string'
					? (entry as { subject: string }).subject.trim()
					: '';
			const object =
				typeof (entry as { object?: unknown }).object === 'string'
					? (entry as { object: string }).object.trim()
					: '';
			const predicate =
				typeof (entry as { predicate?: unknown }).predicate === 'string'
					? (entry as { predicate: string }).predicate.trim()
					: '';
			const confidence = clampConfidence((entry as { confidence?: unknown }).confidence);
			if (!subject || !object || !ALLOWED_ENTITY_PREDICATES.has(predicate)) return null;
			if (!allowedSurfaces.has(subject) || !allowedSurfaces.has(object)) return null;
			return { subject, object, predicate, confidence };
		})
		.filter((v): v is ExtractedEntityTriple => v !== null);
}

/** LLM step 1: surfaces + coarse types for canonicalization. */
export async function extractEntityMentions(input: {
	userId: string;
	normalizedText: string;
}): Promise<ExtractedEntityMention[]> {
	const prompt = [
		'Return ONLY JSON.',
		'Extract notable named entities and noun phrases worth tracking as graph nodes.',
		'Schema: [{"surface":"<text as written>","entityType":"person|org|place|topic|product|other","confidence":0.0-1.0}]',
		'Include 0–12 items. Omit generic pronouns and vague terms.',
		`Text:\n${input.normalizedText}`
	].join('\n');

	const messages: ChatMessage[] = [
		{ role: 'system', content: 'You extract structured entity mentions for a knowledge graph.' },
		{ role: 'user', content: prompt }
	];

	const response = await llmChatCompletion({
		userId: input.userId,
		messages,
		temperature: 0
	});

	return parseEntityMentions(extractChatContent(response));
}

/** LLM step 2: typed edges whose endpoints were mentioned in step 1. */
export async function extractEntityTriples(input: {
	userId: string;
	normalizedText: string;
	mentions: ExtractedEntityMention[];
}): Promise<ExtractedEntityTriple[]> {
	if (input.mentions.length === 0) return [];

	const allowed = new Set(input.mentions.map((m) => m.surface));
	const mentionLines = input.mentions.map((m) => `- ${m.surface} (${m.entityType})`);

	const prompt = [
		'Return ONLY JSON.',
		'Given entity surfaces and text, emit directed relations between those surfaces only.',
		'Allowed predicates: related_to, depends_on, part_of, located_in, knows, works_at.',
		'Schema: [{"subject":"<surface>","object":"<surface>","predicate":"related_to","confidence":0.0-1.0}]',
		'Use empty array if none.',
		`Surfaces:\n${mentionLines.join('\n')}`,
		`Text:\n${input.normalizedText}`
	].join('\n');

	const messages: ChatMessage[] = [
		{ role: 'system', content: 'You extract typed edges between known entity surfaces.' },
		{ role: 'user', content: prompt }
	];

	const response = await llmChatCompletion({
		userId: input.userId,
		messages,
		temperature: 0
	});

	return parseEntityTriples(extractChatContent(response), allowed);
}
