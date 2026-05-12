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

/** Active `ontology_entity_kind` rows — same keys as thought `category` / graph Thought subtype. */
export type OntologyEntityKindForExtraction = {
	key: string;
	name: string;
	definition: string;
};

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

export function parseEntityMentions(
	content: string,
	allowedEntityKindKeys: Set<string>
): ExtractedEntityMention[] {
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
			if (!surface || !allowedEntityKindKeys.has(entityType)) return null;
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

/** LLM step 1: surfaces + ontology entity kind (same catalog as thought categories). */
export async function extractEntityMentions(input: {
	userId: string;
	normalizedText: string;
	ontologyEntityKinds: OntologyEntityKindForExtraction[];
}): Promise<ExtractedEntityMention[]> {
	if (input.ontologyEntityKinds.length === 0) {
		throw new Error('extractEntityMentions requires at least one ontology entity kind');
	}
	const allowed = new Set(input.ontologyEntityKinds.map((k) => k.key));
	const catalog = input.ontologyEntityKinds
		.map((k) => `- entityType must be exactly "${k.key}" (${k.name}): ${k.definition}`)
		.join('\n');
	const keyUnion = [...allowed].sort().join('|');
	const prompt = [
		'Return ONLY JSON.',
		'Extract notable named entities and noun phrases worth tracking as graph nodes.',
		`For each item, entityType must be exactly one of these ontology keys (no other strings): ${keyUnion}`,
		'Pick the single best-matching kind for how that surface functions in the utterance (same taxonomy as classifying thoughts).',
		'Schema: [{"surface":"<text as written>","entityType":"<one of the keys above>","confidence":0.0-1.0}]',
		'Catalog:',
		catalog,
		'Include 0–12 items. Omit generic pronouns and vague terms.',
		`Text:\n${input.normalizedText}`
	].join('\n');

	const messages: ChatMessage[] = [
		{
			role: 'system',
			content:
				'You extract structured entity mentions. entityType must always be an exact key from the user ontology list in the user message, never a free-form category.'
		},
		{ role: 'user', content: prompt }
	];

	const response = await llmChatCompletion({
		userId: input.userId,
		messages,
		temperature: 0
	});

	return parseEntityMentions(extractChatContent(response), allowed);
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
