import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client';
import { stripMarkdownJsonFences } from '$lib/server/memory/llm-json-content';
import { m } from '$lib/paraglide/messages.js';
import {
	ENTITY_EXTRACTION_GRAPH_TRIPLE_GUIDANCE,
	ENTITY_EXTRACTION_OMIT_RULES,
	ENTITY_EXTRACTION_QUALITY_GUIDANCE,
	ENTITY_EXTRACTION_SURFACE_INTEGRITY_RULES,
	ENTITY_EXTRACTION_TYPE_GUIDANCE,
	filterAcceptedEntityMentions
} from '$lib/server/memory/entity-mention-filter';
import { groundingProfilePromptBlock } from '$lib/server/grounding/prompt-block';
import type { GroundingProfileForEnrichment } from '$lib/server/grounding/types';
import { computeLexicalText } from '$lib/server/memory/lexical-text';
import {
	formatCommunityExcerptsForEntityPrompt,
	formatKnownGraphEntitiesPromptBlock,
	type EntityGraphEnrichmentContext,
	type GraphEntityCandidate
} from '$lib/server/memory/entity-graph-enrichment-context';

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

/** A canonical entity already persisted in the user's graph. */
export type KnownEntityHint = {
	/** Canonical entity UUID in Postgres + AGE — omit only in tests. */
	entityId?: string;
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

/** Retry entity extraction when the first pass returns nothing on substantive notes. */
export const ENTITY_EXTRACTION_RETRY_MIN_TEXT_LENGTH = 120;

/** Minimum length for retry on shorter notes (length gate only — not semantic). */
export const ENTITY_EXTRACTION_RETRY_MIN_TEXT_LENGTH_SHORT = 35;

/** Whether a second LLM pass is warranted after zero mentions on the first pass (length only). */
export function shouldRetryEntityMentionExtraction(normalizedText: string): boolean {
	const len = normalizedText.trim().length;
	if (len === 0) return false;
	if (len >= ENTITY_EXTRACTION_RETRY_MIN_TEXT_LENGTH) return true;
	return len >= ENTITY_EXTRACTION_RETRY_MIN_TEXT_LENGTH_SHORT;
}

/**
 * Resolve LLM `entityType` to a canonical key present in `allowed` (exact / case-insensitive match only).
 * XXX REMOVED — ENTITY_TYPE_SYNONYMS code re-typing of LLM output. LLM must return ontology keys.
 */
export function resolveEntityTypeKey(raw: string, allowed: Set<string>): string | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	if (allowed.has(trimmed)) return trimmed;
	const lower = trimmed.toLowerCase();
	for (const key of allowed) {
		if (key.toLowerCase() === lower) return key;
	}
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
			rawEntityTypes,
			allowedEntityTypes: [...allowedEntityKindKeys].sort()
		});
	}

	return filterAcceptedEntityMentions(mentions);
}

const MIN_TRIPLE_CONFIDENCE_DEFAULT = 0.55;
const MIN_TRIPLE_CONFIDENCE_RELATED_TO = 0.75;

/** Post-LLM gate before writing ENTITY_RELATES edges (confidence only — LLM judged the triple). */
export function acceptEntityTriple(
	triple: ExtractedEntityTriple,
	_normalizedText: string
): boolean {
	const minConfidence =
		triple.predicate === 'related_to'
			? MIN_TRIPLE_CONFIDENCE_RELATED_TO
			: MIN_TRIPLE_CONFIDENCE_DEFAULT;
	return triple.confidence >= minConfidence;
}

export function filterAcceptedEntityTriples(input: {
	triples: ExtractedEntityTriple[];
	normalizedText: string;
}): ExtractedEntityTriple[] {
	return input.triples.filter((t) => acceptEntityTriple(t, input.normalizedText));
}

export function parseEntityTriples(
	content: string,
	allowedMentionSurfaces: Set<string>,
	allowedGraphEntityLabels?: Set<string>
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

			const subjectInMentions = allowedMentionSurfaces.has(subject);
			const objectInMentions = allowedMentionSurfaces.has(object);
			const subjectInGraph = allowedGraphEntityLabels?.has(subject) ?? false;
			const objectInGraph = allowedGraphEntityLabels?.has(object) ?? false;
			if (!subjectInMentions && !subjectInGraph) return null;
			if (!objectInMentions && !objectInGraph) return null;
			if (!subjectInMentions && !objectInMentions) return null;

			return { subject, object, predicate, confidence };
		})
		.filter((v): v is ExtractedEntityTriple => v !== null);
}

/** Resolve a triple endpoint to a canonical entity ID (mention surface or known graph label). */
export function resolveTripleEndpointEntityId(
	surface: string,
	surfaceToEntityId: Map<string, string>,
	graphEntityIdByLabel: Map<string, string>
): string | undefined {
	const trimmed = surface.trim();
	if (!trimmed) return undefined;
	return (
		surfaceToEntityId.get(trimmed) ??
		graphEntityIdByLabel.get(trimmed) ??
		graphEntityIdByLabel.get(computeLexicalText(trimmed))
	);
}

export function graphEntityLabelsFromContext(
	graphEntities: GraphEntityCandidate[]
): Set<string> {
	return new Set(graphEntities.map((e) => e.label.trim()).filter(Boolean));
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
			? `\nKnown entities already in memory. Include a mention ONLY when the text clearly names or refers to that entity. Never replace a name in the text with a different known entity:\n${input.knownEntities
					.map((e) => `- ${e.label} (${e.entityType})`)
					.join('\n')}`
			: '';

	const minimumRule =
		pass === 'retry_minimum'
			? 'Return at least 2 items when the text names people, allergies, food, places, procedures, anatomy, devices, measurements, or institutions. Never return an empty array for substantive notes. Still omit greetings and interjections.'
			: pass === 'retry_verbatim'
				? 'Return every proper noun and concrete noun phrase appearing verbatim in the text. When the text names a person and a requirement or condition, return at least 2 items. Copy surfaces exactly as written in the text. Still omit greetings and interjections.'
				: 'Include 0–12 items. Omit generic pronouns and vague terms.';

	const prompt = [
		'Return ONLY JSON.',
		'Extract notable named entities and noun phrases worth tracking as graph nodes (including procedures, anatomy, devices, and institutions when they are concrete spans in the text).',
		...ENTITY_EXTRACTION_OMIT_RULES,
		...ENTITY_EXTRACTION_SURFACE_INTEGRITY_RULES,
		`For each item, entityType must be exactly one of these keys, copied verbatim in lowercase ASCII (no other strings): ${keyUnion}`,
		...ENTITY_EXTRACTION_TYPE_GUIDANCE,
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
			content: m.llm_entity_extraction_system()
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
		{ role: 'system', content: m.llm_entity_triple_system() },
		{ role: 'user', content: prompt }
	];

	const response = await llmChatCompletion({
		userId: input.userId,
		messages,
		temperature: 0
	});

	return parseEntityTriples(stripMarkdownJsonFences(extractChatContent(response)), allowed);
}

type ExtractEntityGraphPass = ExtractEntityMentionsPass;

async function extractEntityGraphOnce(
	input: {
		userId: string;
		normalizedText: string;
		ontologyEntityKinds: OntologyEntityKindForExtraction[];
		knownEntities?: KnownEntityHint[];
		groundingProfile?: GroundingProfileForEnrichment;
		enrichmentContext?: EntityGraphEnrichmentContext;
	},
	pass: ExtractEntityGraphPass
): Promise<{ mentions: ExtractedEntityMention[]; triples: ExtractedEntityTriple[] }> {
	const allowed = new Set(input.ontologyEntityKinds.map((k) => k.key));
	const catalog = input.ontologyEntityKinds
		.map((k) => `- entityType must be exactly "${k.key}" (${k.name}): ${k.definition}`)
		.join('\n');
	const keyUnion = [...allowed].sort().join('|');

	const ctx = input.enrichmentContext;
	const groundingBlock = groundingProfilePromptBlock(
		ctx?.groundingProfile ?? input.groundingProfile ?? null
	);
	const communityBlock = formatCommunityExcerptsForEntityPrompt(ctx?.communityExcerpts ?? []);
	const graphEntitiesBlock = formatKnownGraphEntitiesPromptBlock(ctx?.graphEntities ?? []);

	const legacyKnownBlock =
		!ctx && input.knownEntities && input.knownEntities.length > 0
			? `\nKnown entities already in memory. Include a mention ONLY when the text clearly names or refers to that entity. Never replace a name in the text with a different known entity:\n${input.knownEntities
					.map((e) =>
						e.entityId
							? `- id=${e.entityId} label="${e.label}" type=${e.entityType}`
							: `- ${e.label} (${e.entityType})`
					)
					.join('\n')}`
			: '';

	const minimumRule =
		pass === 'retry_minimum'
			? 'Return at least 2 mentions when the text names people, allergies, food, places, procedures, anatomy, devices, measurements, or institutions. Never return an empty mentions array for substantive notes. Still omit greetings and interjections.'
			: pass === 'retry_verbatim'
				? 'Return every proper noun and concrete noun phrase appearing verbatim in the text. When the text names a person and a requirement or condition, return at least 2 mentions. Copy surfaces exactly as written in the text. Still omit greetings and interjections.'
				: 'Include 0–12 mentions. Omit generic pronouns and vague terms.';

	const prompt = [
		'Return ONLY JSON with this shape:',
		'{',
		'  "mentions": [{"surface":"<text as written>","entityType":"<key>","confidence":0.0-1.0}],',
		'  "triples": [{"subject":"<surface>","object":"<surface>","predicate":"related_to","confidence":0.0-1.0}]',
		'}',
		'',
		groundingBlock,
		communityBlock,
		graphEntitiesBlock,
		legacyKnownBlock,
		'Extract notable named entities and noun phrases worth tracking as graph nodes.',
		...ENTITY_EXTRACTION_QUALITY_GUIDANCE,
		...ENTITY_EXTRACTION_OMIT_RULES,
		...ENTITY_EXTRACTION_SURFACE_INTEGRITY_RULES,
		`For each mention, entityType must be exactly one of: ${keyUnion}`,
		...ENTITY_EXTRACTION_TYPE_GUIDANCE,
		'Allowed triple predicates: related_to, depends_on, part_of, located_in, knows, works_at.',
		'Triples must reference mention surfaces and/or labels from the existing graph entities block. At least one triple endpoint must be a mention from this thought. Use empty triples array if none.',
		...ENTITY_EXTRACTION_GRAPH_TRIPLE_GUIDANCE,
		'Catalog:',
		catalog,
		minimumRule,
		`Text:\n${input.normalizedText}`
	]
		.filter(Boolean)
		.join('\n');

	const messages: ChatMessage[] = [
		{
			role: 'system',
			content:
				'You extract entity mentions and typed edges for a personal memory graph. Use grounding, community themes, and existing graph entity IDs to extract what matters and wire items to hubs. Keep multi-word titles as single surfaces; use person only for human beings. Return only valid JSON.'
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
		const parsed = JSON.parse(content) as unknown;
		if (!parsed || typeof parsed !== 'object') {
			throw new Error('Entity graph bundle output must be a JSON object');
		}
		const obj = parsed as { mentions?: unknown; triples?: unknown };
		const mentions = parseEntityMentions(
			JSON.stringify(Array.isArray(obj.mentions) ? obj.mentions : []),
			allowed
		);
		const allowedMentionSurfaces = new Set(mentions.map((m) => m.surface));
		const allowedGraphLabels = graphEntityLabelsFromContext(ctx?.graphEntities ?? []);
		const triples = parseEntityTriples(
			JSON.stringify(Array.isArray(obj.triples) ? obj.triples : []),
			allowedMentionSurfaces,
			allowedGraphLabels.size > 0 ? allowedGraphLabels : undefined
		);
		return { mentions, triples };
	} catch (err) {
		console.warn('[entity-extraction] invalid graph bundle JSON from LLM', {
			userId: input.userId,
			pass,
			message: err instanceof Error ? err.message : String(err)
		});
		return { mentions: [], triples: [] };
	}
}

/** Single LLM call: entity mentions + typed triples. */
export async function extractEntityGraphBundle(input: {
	userId: string;
	normalizedText: string;
	ontologyEntityKinds: OntologyEntityKindForExtraction[];
	knownEntities?: KnownEntityHint[];
	groundingProfile?: GroundingProfileForEnrichment;
	enrichmentContext?: EntityGraphEnrichmentContext;
}): Promise<{ mentions: ExtractedEntityMention[]; triples: ExtractedEntityTriple[] }> {
	if (input.ontologyEntityKinds.length === 0) {
		throw new Error('extractEntityGraphBundle requires at least one ontology entity kind');
	}

	let bundle = await extractEntityGraphOnce(input, 'default');
	const textLen = input.normalizedText.trim().length;
	if (bundle.mentions.length === 0 && shouldRetryEntityMentionExtraction(input.normalizedText)) {
		console.warn('[entity-extraction] zero mentions in graph bundle; retrying with minimum rule', {
			userId: input.userId,
			textLen
		});
		bundle = await extractEntityGraphOnce(input, 'retry_minimum');
	}
	if (bundle.mentions.length === 0 && shouldRetryEntityMentionExtraction(input.normalizedText)) {
		console.warn('[entity-extraction] zero mentions after minimum retry; retrying verbatim', {
			userId: input.userId,
			textLen
		});
		bundle = await extractEntityGraphOnce(input, 'retry_verbatim');
	}
	if (bundle.mentions.length === 0 && shouldRetryEntityMentionExtraction(input.normalizedText)) {
		console.warn('[entity-extraction] zero mentions after all graph bundle retries', {
			userId: input.userId,
			textLen
		});
	}
	return bundle;
}
