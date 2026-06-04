import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client';
import { stripMarkdownJsonFences } from '$lib/server/memory/llm-json-content';

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

/** Active `ontology_entity_kind` rows with kind_type = 'entity_type'. */
export type OntologyEntityKindForExtraction = {
	key: string;
	name: string;
	definition: string;
};

/** A known canonical entity to surface to the LLM to reduce surface-form variance. */
export type KnownEntityHint = {
	label: string;
	entityType: string;
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

/** Map common model drift to seeded ontology `entity_type` keys (always lowercase in DB). */
const ENTITY_TYPE_SYNONYMS: Record<string, string> = {
	org: 'organization',
	orgs: 'organization',
	tech: 'technology',
	location: 'place',
	locations: 'place',
	device: 'technology',
	equipment: 'technology',
	tool: 'technology',
	procedure: 'event',
	procedures: 'event',
	surgery: 'event',
	anatomy: 'place',
	landmark: 'place',
	landmarks: 'place',
	institution: 'organization',
	medical_device: 'technology',
	system: 'technology',
	abstract: 'concept',
	topic: 'concept',
	theme: 'concept',
	idea: 'concept',
	human: 'person',
	individual: 'person',
	character: 'person',
	name: 'person',
	audio: 'concept',
	sound: 'concept'
};

/** Retry entity extraction when the first pass returns nothing on substantive notes. */
export const ENTITY_EXTRACTION_RETRY_MIN_TEXT_LENGTH = 120;

/** Shorter notes that still name people, allergies, or multiple proper nouns. */
export const ENTITY_EXTRACTION_RETRY_MIN_TEXT_LENGTH_SHORT = 50;

/** Substantive notes that should not end with zero entity mentions after retries. */
export const ENTITY_RETRY_SIGNAL =
	/\b(?:allergic|allergy|birthday|born|works at|located in|met with|called|named|needs?|requires?)\b/i;

/** Whether a second LLM pass is warranted after zero mentions on the first pass. */
export function shouldRetryEntityMentionExtraction(normalizedText: string): boolean {
	const text = normalizedText.trim();
	const len = text.length;
	if (len === 0) return false;
	if (len >= ENTITY_EXTRACTION_RETRY_MIN_TEXT_LENGTH) return true;
	if (len < ENTITY_EXTRACTION_RETRY_MIN_TEXT_LENGTH_SHORT) return false;
	if (ENTITY_RETRY_SIGNAL.test(text)) return true;
	if (/(?:^|[.!?]\s+)[A-Z][a-z]{2,}/.test(text)) return true;
	if (/\b[A-Z][a-z]{2,}\b.*\b[A-Z][a-z]{2,}\b/.test(text)) return true;
	return false;
}

/**
 * Resolve LLM `entityType` to a canonical key present in `allowed`.
 * Models often return Title Case or shorthand ("org") that would otherwise be filtered out.
 */
export function resolveEntityTypeKey(raw: string, allowed: Set<string>): string | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	if (allowed.has(trimmed)) return trimmed;
	const lower = trimmed.toLowerCase();
	for (const key of allowed) {
		if (key.toLowerCase() === lower) return key;
	}
	const mapped = ENTITY_TYPE_SYNONYMS[lower];
	if (mapped && allowed.has(mapped)) return mapped;
	return null;
}

export function parseEntityMentions(
	content: string,
	allowedEntityKindKeys: Set<string>
): ExtractedEntityMention[] {
	const parsed = JSON.parse(content) as unknown;
	if (!Array.isArray(parsed)) {
		throw new Error('Entity extraction output must be a JSON array');
	}
	const rawEntityTypes: string[] = [];
	const mentions = parsed
		.map((entry) => {
			if (!entry || typeof entry !== 'object') return null;
			const surface =
				typeof (entry as { surface?: unknown }).surface === 'string'
					? (entry as { surface: string }).surface.trim()
					: '';
			const rawEntityType =
				typeof (entry as { entityType?: unknown }).entityType === 'string'
					? (entry as { entityType: string }).entityType.trim()
					: '';
			if (rawEntityType) rawEntityTypes.push(rawEntityType);
			const confidence = clampConfidence((entry as { confidence?: unknown }).confidence);
			const entityType = resolveEntityTypeKey(rawEntityType, allowedEntityKindKeys);
			if (!surface || !entityType) return null;
			return { surface, entityType, confidence };
		})
		.filter((v): v is ExtractedEntityMention => v !== null);

	if (parsed.length > 0 && mentions.length === 0) {
		console.warn('[entity-extraction] all LLM mentions dropped (invalid entityType?)', {
			rawEntityTypes
		});
	}

	return mentions;
}

const MIN_TRIPLE_CONFIDENCE_DEFAULT = 0.55;
const MIN_TRIPLE_CONFIDENCE_RELATED_TO = 0.75;

function lexicalContextSupportsTriple(
	triple: ExtractedEntityTriple,
	normalizedText: string
): boolean {
	const text = normalizedText.toLowerCase();
	const subject = triple.subject.trim().toLowerCase();
	const object = triple.object.trim().toLowerCase();
	if (!subject || !object) return false;
	return text.includes(subject) && text.includes(object);
}

/** Post-LLM gate before writing ENTITY_RELATES edges. */
export function acceptEntityTriple(
	triple: ExtractedEntityTriple,
	normalizedText: string
): boolean {
	const minConfidence =
		triple.predicate === 'related_to'
			? MIN_TRIPLE_CONFIDENCE_RELATED_TO
			: MIN_TRIPLE_CONFIDENCE_DEFAULT;
	if (triple.confidence < minConfidence) return false;
	if (triple.predicate === 'related_to') {
		return lexicalContextSupportsTriple(triple, normalizedText);
	}
	return true;
}

export function filterAcceptedEntityTriples(input: {
	triples: ExtractedEntityTriple[];
	normalizedText: string;
}): ExtractedEntityTriple[] {
	return input.triples.filter((t) => acceptEntityTriple(t, input.normalizedText));
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

type ExtractEntityMentionsPass = 'default' | 'retry_minimum' | 'retry_verbatim';

async function extractEntityMentionsOnce(
	input: {
		userId: string;
		normalizedText: string;
		ontologyEntityKinds: OntologyEntityKindForExtraction[];
		knownEntities?: KnownEntityHint[];
	},
	pass: ExtractEntityMentionsPass
): Promise<ExtractedEntityMention[]> {
	const allowed = new Set(input.ontologyEntityKinds.map((k) => k.key));
	const catalog = input.ontologyEntityKinds
		.map((k) => `- entityType must be exactly "${k.key}" (${k.name}): ${k.definition}`)
		.join('\n');
	const keyUnion = [...allowed].sort().join('|');

	const knownEntitiesBlock =
		input.knownEntities && input.knownEntities.length > 0
			? `\nKnown entities already in memory (prefer these surface forms when referring to the same thing):\n${input.knownEntities
					.map((e) => `- ${e.label} (${e.entityType})`)
					.join('\n')}`
			: '';

	const minimumRule =
		pass === 'retry_minimum'
			? 'Return at least 2 items when the text names people, allergies, food, places, procedures, anatomy, devices, measurements, or institutions. Never return an empty array for substantive notes.'
			: pass === 'retry_verbatim'
				? 'Return every proper noun and concrete noun phrase appearing verbatim in the text. When the text names a person and a requirement or condition, return at least 2 items. Copy surfaces exactly as written in the text.'
				: 'Include 0–12 items. Omit generic pronouns and vague terms.';

	const prompt = [
		'Return ONLY JSON.',
		'Extract notable named entities and noun phrases worth tracking as graph nodes (including procedures, anatomy, devices, and institutions when they are concrete spans in the text).',
		`For each item, entityType must be exactly one of these keys, copied verbatim in lowercase ASCII (no other strings): ${keyUnion}`,
		'Pick the single best-matching real-world entity type for each surface. Use organization (never "org"), technology for tools/systems/devices, place for locations/anatomy sites when typed as a location, concept for abstract topics, artifact for documents, event for time-bounded occurrences or procedures.',
		'Never invent entityType labels such as procedure, anatomy, device, or landmark — map them to the keys above.',
		'Schema: [{"surface":"<text as written>","entityType":"<one of the keys above>","confidence":0.0-1.0}]',
		'Catalog:',
		catalog,
		knownEntitiesBlock,
		minimumRule,
		`Text:\n${input.normalizedText}`
	]
		.filter(Boolean)
		.join('\n');

	const messages: ChatMessage[] = [
		{
			role: 'system',
			content:
				'You extract structured entity mentions. entityType must always be an exact key from the entity type list in the user message, never a free-form category.'
		},
		{ role: 'user', content: prompt }
	];

	const response = await llmChatCompletion({
		userId: input.userId,
		messages,
		temperature: 0
	});
	const content = stripMarkdownJsonFences(extractChatContent(response));
	try {
		return parseEntityMentions(content, allowed);
	} catch (err) {
		console.warn('[entity-extraction] invalid mention JSON from LLM', {
			userId: input.userId,
			pass,
			message: err instanceof Error ? err.message : String(err)
		});
		return [];
	}
}

/** LLM step 1: surfaces + entity type (real-world entity type catalog, separate from thought categories). */
export async function extractEntityMentions(input: {
	userId: string;
	normalizedText: string;
	ontologyEntityKinds: OntologyEntityKindForExtraction[];
	/** Existing canonical entities that may be referenced — helps LLM use consistent surface forms. */
	knownEntities?: KnownEntityHint[];
}): Promise<ExtractedEntityMention[]> {
	if (input.ontologyEntityKinds.length === 0) {
		throw new Error('extractEntityMentions requires at least one ontology entity kind');
	}

	let mentions = await extractEntityMentionsOnce(input, 'default');
	const textLen = input.normalizedText.trim().length;
	if (mentions.length === 0 && shouldRetryEntityMentionExtraction(input.normalizedText)) {
		console.warn('[entity-extraction] zero mentions on first pass; retrying with minimum rule', {
			userId: input.userId,
			textLen
		});
		mentions = await extractEntityMentionsOnce(input, 'retry_minimum');
	}
	if (mentions.length === 0 && shouldRetryEntityMentionExtraction(input.normalizedText)) {
		console.warn('[entity-extraction] zero mentions after minimum retry; retrying verbatim', {
			userId: input.userId,
			textLen
		});
		mentions = await extractEntityMentionsOnce(input, 'retry_verbatim');
	}
	if (mentions.length === 0 && shouldRetryEntityMentionExtraction(input.normalizedText)) {
		console.warn('[entity-extraction] zero mentions after all retries', {
			userId: input.userId,
			textLen
		});
	}
	return mentions;
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

	return parseEntityTriples(stripMarkdownJsonFences(extractChatContent(response)), allowed);
}
