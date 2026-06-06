import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { canonicalEntity, entityResolutionLog } from '$lib/server/db/schema';
import { fetchEntityEdgesForUser } from '$lib/server/graph/age';
import { buildEntityAdjacency, neighborEntityIds } from '$lib/server/memory/entity-link-graph';
import { tokenizeLexicalQuery } from '$lib/server/memory/lexical-fold';
import { computeLexicalText } from '$lib/server/memory/lexical-text';
import { ENTITY_RETRY_SIGNAL, type KnownEntityHint } from '$lib/server/memory/entity-extraction';
import { isRejectedEntitySurface } from '$lib/server/memory/entity-mention-filter';

const GRAPH_HINT_LIMIT = 12;

const TEXT_HINT_STOP_WORDS = new Set([
	'that',
	'this',
	'with',
	'from',
	'have',
	'been',
	'were',
	'they',
	'them',
	'least',
	'minutes',
	'hours',
	'before',
	'after',
	'about',
	'into',
	'over',
	'some',
	'more',
	'very',
	'much',
	'also',
	'just',
	'only',
	'when',
	'where',
	'what',
	'which',
	'while',
	'there',
	'their',
	'would',
	'could',
	'should',
	'completely',
	'kill',
	'kills',
	'killed',
	'work',
	'creative',
	'flow'
]);

/** Sentence-initial capitalized words that are usually adverbs, not proper names. */
const SENTENCE_START_PROPER_NOUN_SKIP = new Set([
	'before',
	'after',
	'when',
	'what',
	'where',
	'while',
	'since',
	'until',
	'because',
	'although',
	'however',
	'during',
	'between',
	'through',
	'without',
	'within',
	'every',
	'always',
	'never',
	'sometimes',
	'often'
]);

/** Sentence-initial German pronouns — not proper names. */
const GERMAN_PRONOUNS_AT_START = new Set(['sie', 'ich', 'er', 'es', 'wir', 'ihr', 'du']);

const LEXICAL_HINT_SCAN_LIMIT = 200;

/** Canonical labels that are pronouns or idioms — not useful graph hints. */
export function isRejectedLexicalEntityLabel(label: string, normalizedText: string): boolean {
	const lower = label.trim().toLowerCase();
	if (GERMAN_PRONOUNS_AT_START.has(lower)) return true;
	if (isRejectedEntitySurface(label)) return true;
	if (lower === 'hause' && /\bzu\s+hause\b/i.test(normalizedText)) return true;
	return false;
}

/** Whole-token match for single-word labels; phrase match for multi-word labels. */
export function lexicalLabelAppearsInText(normalizedText: string, label: string): boolean {
	const labelKey = computeLexicalText(label);
	if (!labelKey) return false;
	const labelTokens = labelKey.split(' ').filter((t) => t.length > 0);
	if (labelTokens.length === 1) {
		return tokenizeLexicalQuery(normalizedText).includes(labelTokens[0]!);
	}
	return computeLexicalText(normalizedText).includes(labelKey);
}

/**
 * Known-entity hints from graph context (same-thought resolutions + ENTITY_RELATES neighbors).
 * Does not use embedding similarity.
 */
export async function loadGraphKnownEntityHints(input: {
	userId: string;
	thoughtId: string;
}): Promise<KnownEntityHint[]> {
	const db = getDb();
	const resolved = await db
		.select({
			entityId: entityResolutionLog.canonicalEntityId,
			label: canonicalEntity.label,
			entityType: canonicalEntity.entityType
		})
		.from(entityResolutionLog)
		.innerJoin(
			canonicalEntity,
			and(
				eq(entityResolutionLog.canonicalEntityId, canonicalEntity.id),
				eq(canonicalEntity.userId, input.userId)
			)
		)
		.where(
			and(
				eq(entityResolutionLog.userId, input.userId),
				eq(entityResolutionLog.thoughtId, input.thoughtId),
				isNotNull(entityResolutionLog.canonicalEntityId)
			)
		);

	const byId = new Map<string, KnownEntityHint>();
	for (const row of resolved) {
		if (!row.entityId) continue;
		byId.set(row.entityId, { label: row.label, entityType: row.entityType });
	}

	const seedIds = [...byId.keys()];
	if (seedIds.length === 0) return [];

	const edges = await fetchEntityEdgesForUser({ userId: input.userId });
	const adjacency = buildEntityAdjacency(edges);
	const neighborIds = neighborEntityIds(adjacency, seedIds);

	const missingNeighborIds = [...neighborIds].filter((id) => !byId.has(id)).slice(0, GRAPH_HINT_LIMIT);
	if (missingNeighborIds.length > 0) {
		const rows = await db
			.select({
				id: canonicalEntity.id,
				label: canonicalEntity.label,
				entityType: canonicalEntity.entityType
			})
			.from(canonicalEntity)
			.where(
				and(eq(canonicalEntity.userId, input.userId), inArray(canonicalEntity.id, missingNeighborIds))
			);

		for (const row of rows) {
			byId.set(row.id, { label: row.label, entityType: row.entityType });
		}
	}

	return [...byId.values()].slice(0, GRAPH_HINT_LIMIT);
}

/**
 * Canonical entities whose labels appear in the thought text (helps short notes that reference Marcus, etc.).
 */
export async function loadLexicalCanonicalEntityHints(input: {
	userId: string;
	normalizedText: string;
}): Promise<KnownEntityHint[]> {
	const textKey = computeLexicalText(input.normalizedText);
	if (!textKey) return [];

	const rows = await getDb()
		.select({
			label: canonicalEntity.label,
			entityType: canonicalEntity.entityType
		})
		.from(canonicalEntity)
		.where(eq(canonicalEntity.userId, input.userId))
		.limit(LEXICAL_HINT_SCAN_LIMIT);

	const hints: KnownEntityHint[] = [];
	const seen = new Set<string>();
	for (const row of rows) {
		const label = typeof row.label === 'string' ? row.label.trim() : '';
		if (label.length < 2) continue;
		if (isRejectedLexicalEntityLabel(label, input.normalizedText)) continue;
		if (!lexicalLabelAppearsInText(input.normalizedText, label)) continue;
		const labelKey = computeLexicalText(label);
		const dedupe = `${labelKey}\0${row.entityType}`;
		if (seen.has(dedupe)) continue;
		seen.add(dedupe);
		hints.push({ label, entityType: row.entityType });
		if (hints.length >= GRAPH_HINT_LIMIT) break;
	}
	return hints;
}

/**
 * Deterministic hints from the thought text itself (proper nouns, requirement nouns).
 * Prompt-only — does not write resolution rows.
 */
export function loadTextDerivedEntityHints(normalizedText: string): KnownEntityHint[] {
	const hints: KnownEntityHint[] = [];
	const seen = new Set<string>();

	const addHint = (label: string, entityType: string) => {
		const trimmed = label.trim();
		if (trimmed.length < 2) return;
		const key = computeLexicalText(trimmed);
		if (!key || seen.has(key)) return;
		seen.add(key);
		hints.push({ label: trimmed, entityType });
	};

	for (const match of normalizedText.matchAll(/\b([A-Z][a-z]{2,})\b/g)) {
		const label = match[1]!;
		const index = match.index ?? 0;
		const isSentenceStart =
			index === 0 || /[.!?]\s*$/.test(normalizedText.slice(0, index));
		if (isSentenceStart && SENTENCE_START_PROPER_NOUN_SKIP.has(label.toLowerCase())) continue;
		if (isSentenceStart && GERMAN_PRONOUNS_AT_START.has(label.toLowerCase())) continue;
		if (isRejectedEntitySurface(label)) continue;
		if (label.toLowerCase() === 'hause' && /\bzu\s*$/i.test(normalizedText.slice(0, index))) continue;
		addHint(label, 'person');
	}

	if (!ENTITY_RETRY_SIGNAL.test(normalizedText)) {
		return hints.slice(0, GRAPH_HINT_LIMIT);
	}

	for (const match of normalizedText.matchAll(/\b(?:allergic|allergy)\s+to\s+([a-z]{3,})\b/gi)) {
		addHint(match[1]!, 'concept');
	}

	for (const match of normalizedText.matchAll(
		/\b(?:needs?|requires?)\b[^.]{0,100}?\b(?:of|to|for)\s+([a-z]{3,})\b/gi
	)) {
		addHint(match[1]!, 'concept');
	}

	const needMatch = normalizedText.match(/\b(?:needs?|requires?)\b/i);
	if (needMatch?.index !== undefined) {
		const window = normalizedText.slice(needMatch.index, needMatch.index + 100);
		for (const match of window.matchAll(/\b([a-z]{4,})\b/g)) {
			const word = match[1]!;
			if (!TEXT_HINT_STOP_WORDS.has(word.toLowerCase())) {
				addHint(word, 'concept');
			}
		}
	}

	return hints.slice(0, GRAPH_HINT_LIMIT);
}

/**
 * Pre-ingest entity hints from the capture text and the user's canonical entity index.
 * Safe before the thought row exists (no thoughtId / graph neighbors).
 */
export async function loadIngestKnownEntityHints(input: {
	userId: string;
	normalizedText: string;
}): Promise<KnownEntityHint[]> {
	const textDerivedHints = loadTextDerivedEntityHints(input.normalizedText);
	const lexicalHints = await loadLexicalCanonicalEntityHints({
		userId: input.userId,
		normalizedText: input.normalizedText
	});

	const byLabel = new Map<string, KnownEntityHint>();
	for (const hint of [...textDerivedHints, ...lexicalHints]) {
		const key = computeLexicalText(hint.label);
		if (!key || byLabel.has(key)) continue;
		byLabel.set(key, hint);
	}
	return [...byLabel.values()].slice(0, GRAPH_HINT_LIMIT);
}

/** Graph neighbors for this thought plus lexical matches from the user's entity index. */
export async function loadEntityHintsForThought(input: {
	userId: string;
	thoughtId: string;
	normalizedText: string;
}): Promise<KnownEntityHint[]> {
	const textDerivedHints = loadTextDerivedEntityHints(input.normalizedText);

	const [graphHints, lexicalHints] = await Promise.all([
		loadGraphKnownEntityHints({ userId: input.userId, thoughtId: input.thoughtId }),
		loadLexicalCanonicalEntityHints({
			userId: input.userId,
			normalizedText: input.normalizedText
		})
	]);

	const byLabel = new Map<string, KnownEntityHint>();
	for (const hint of [...textDerivedHints, ...graphHints, ...lexicalHints]) {
		const key = computeLexicalText(hint.label);
		if (!key || byLabel.has(key)) continue;
		byLabel.set(key, hint);
	}
	return [...byLabel.values()].slice(0, GRAPH_HINT_LIMIT);
}
