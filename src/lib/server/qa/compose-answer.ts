import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { thought, thoughtRelation } from '$lib/server/db/schema';
import { createThoughtEmbedding } from '$lib/server/llm/embedding';
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client';
import { tokenizeLexicalQuery } from '$lib/server/memory/lexical-fold';
import { searchThoughts } from '$lib/server/retrieval/service';
import { CONTEXT_WEIGHTS } from '$lib/server/retrieval';
import { tryRecordRetrievalQualityEvent } from '$lib/server/retrieval/quality-telemetry';
import {
	findTemporalSchedulingConflicts,
	formatTemporalConflictsForPrompt,
	isSchedulingConflictQuery
} from '$lib/server/retrieval/temporal-conflicts';
import { isThoughtStaleByAge } from '$lib/server/memory/thought-staleness';
import { loadTemporalContextByThoughtIds } from '$lib/server/memory/temporal-context';
import {
	formatTemporalAnnotation,
	type TemporalEventValidity,
	type ThoughtTemporalStatus
} from '$lib/server/memory/temporal-validity';
import type { MemoryType } from '$lib/server/db/brain.schema';
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption';
import {
	CITATION_TOKEN_RE,
	canonicalCitationToken,
	normalizeCitationTokens
} from '$lib/chat/citation-tokens';

/** Thoughts older than this threshold (in ms) are considered potentially stale. */
const STALENESS_THRESHOLD_MS = 6 * 30 * 24 * 60 * 60 * 1000; // ~6 months

export type RetrievalContextItem = {
	id: string;
	normalizedText: string;
	category: string;
	score: number;
	vectorScore: number;
	graphScore: number;
	createdAt: Date;
	/** Optional AGE graph / entity path hint from hybrid retrieval. */
	graphProvenance?: string;
	/** True when the thought was stored more than 6 months ago. */
	isStale: boolean;
	/** Validity of linked temporal_event rows relative to answer time. */
	temporalStatus: ThoughtTemporalStatus;
	temporalEvents: TemporalEventValidity[];
};

export type ConflictPair = {
	ids: [string, string];
	subject: string;
	description: string;
};

export type ComposedAnswer = {
	answer: string;
	citations: string[];
	retrieved: RetrievalContextItem[];
	/** Contradiction pairs detected among retrieved thoughts, if any. */
	conflicts: ConflictPair[];
};

export type ComposeAnswerProgressPhase = 'embedding' | 'searching' | 'composing';

export type ComposeAnswerInput = {
	userId: string;
	question: string;
	/** When set (e.g. eval retrieval probe), also search with this query and merge hits. */
	retrievalQuery?: string;
	topK?: number;
	weights?: { vector: number; graph: number };
	onProgress?: (phase: ComposeAnswerProgressPhase) => void | Promise<void>;
};

/** User-facing text from a composed Q&A result (used when skipping a second agent LLM turn). */
export function formatComposedAnswerForUser(answer: string): string {
	return normalizeCitationTokens(answer.trim());
}

type SearchHit = Awaited<ReturnType<typeof searchThoughts>>[number];

const RETRIEVAL_HINT_STOPWORDS = new Set([
	'wer',
	'ist',
	'was',
	'wie',
	'wo',
	'wann',
	'warum',
	'who',
	'what',
	'when',
	'where',
	'why',
	'how',
	'is',
	'are',
	'the',
	'a',
	'an',
	'to',
	'now'
]);

/** Focused tokens for a second retrieval pass (names, codes) on short questions. */
export function extractRetrievalHints(question: string): string | undefined {
	const tokens = tokenizeLexicalQuery(question).filter((t) => t.length >= 2);
	const hints = tokens.filter((t) => !RETRIEVAL_HINT_STOPWORDS.has(t));
	if (hints.length === 0) return undefined;
	const hintQuery = hints.join(' ');
	const normalizedQuestion = tokenizeLexicalQuery(question).join(' ');
	if (hintQuery === normalizedQuestion) return undefined;
	return hintQuery;
}

// ---------------------------------------------------------------------------
// Contradiction detection (sentiment / location updates — not scheduling)
// ---------------------------------------------------------------------------

const POLARITY_POSITIVE = /\b(love|great|excellent|amazing|wonderful|perfect|fantastic|good|enjoy|like|productive|calmer)\b/i;
const POLARITY_NEGATIVE = /\b(hate|terrible|awful|horrible|dreadful|bad|dislike|can't stand|waste|discipline)\b/i;
const LOCATION_PATTERN = /\b(?:live|living|moved|move)\s+(?:in|to)\s+([A-Z][a-zA-Z]+)/;

/** Topic clusters: if both thoughts touch the same cluster, treat as the same subject for sentiment conflicts. */
const TOPIC_CLUSTERS: readonly string[][] = [
	['remote', 'work', 'wfh', 'office', 'commute', 'home', 'working']
];

function normalizeTopicTokens(text: string): Set<string> {
	return new Set(
		text
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, ' ')
			.split(/\s+/)
			.filter((t) => t.length >= 3)
	);
}

function sharedTopicCluster(aText: string, bText: string): string | undefined {
	const aTokens = normalizeTopicTokens(aText);
	const bTokens = normalizeTopicTokens(bText);
	for (const cluster of TOPIC_CLUSTERS) {
		const aHit = cluster.some((term) => aTokens.has(term) || aText.toLowerCase().includes(term));
		const bHit = cluster.some((term) => bTokens.has(term) || bText.toLowerCase().includes(term));
		if (aHit && bHit) return cluster[0];
	}
	return undefined;
}

function extractSubjectKey(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.split(/\s+/)
		.filter((t) => t.length > 3)
		.slice(0, 4)
		.join(' ');
}

export function detectContradictions(items: RetrievalContextItem[]): ConflictPair[] {
	const conflicts: ConflictPair[] = [];

	const locationBySubject = new Map<string, Array<{ id: string; location: string; createdAt: Date }>>();
	for (const item of items) {
		const locMatch = LOCATION_PATTERN.exec(item.normalizedText);
		if (locMatch) {
			const location = locMatch[1];
			const key = 'location';
			if (!locationBySubject.has(key)) locationBySubject.set(key, []);
			locationBySubject.get(key)!.push({ id: item.id, location, createdAt: item.createdAt });
		}
	}
	for (const [, entries] of locationBySubject) {
		if (entries.length < 2) continue;
		const sorted = [...entries].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
		const first = sorted[0];
		const last = sorted[sorted.length - 1];
		if (first.location !== last.location) {
			conflicts.push({
				ids: [first.id, last.id],
				subject: 'location',
				description: `Earlier thought says "${first.location}", later thought says "${last.location}"`
			});
		}
	}

	for (let i = 0; i < items.length; i++) {
		for (let j = i + 1; j < items.length; j++) {
			const a = items[i];
			const b = items[j];
			const aPos = POLARITY_POSITIVE.test(a.normalizedText);
			const aNeg = POLARITY_NEGATIVE.test(a.normalizedText);
			const bPos = POLARITY_POSITIVE.test(b.normalizedText);
			const bNeg = POLARITY_NEGATIVE.test(b.normalizedText);

			if (!((aPos && bNeg) || (aNeg && bPos))) continue;

			const aKey = extractSubjectKey(a.normalizedText);
			const bKey = extractSubjectKey(b.normalizedText);
			const aWords = new Set(aKey.split(' '));
			const bWords = new Set(bKey.split(' '));
			const shared = [...aWords].filter((w) => bWords.has(w));
			const topic = shared.length >= 1 ? shared[0] : sharedTopicCluster(a.normalizedText, b.normalizedText);
			if (!topic) continue;

			conflicts.push({
				ids: [a.id, b.id],
				subject: topic,
				description: `These thoughts appear to hold opposing views about "${topic}"`
			});
		}
	}

	const seen = new Set<string>();
	return conflicts.filter((c) => {
		const key = [...c.ids].sort().join('::');
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function mergeConflictPairs(a: ConflictPair[], b: ConflictPair[]): ConflictPair[] {
	const seen = new Set<string>();
	const merged: ConflictPair[] = [];
	for (const pair of [...a, ...b]) {
		const key = [...pair.ids].sort().join('::');
		if (seen.has(key)) continue;
		seen.add(key);
		merged.push(pair);
	}
	return merged;
}

/** Contradictions persisted during enrichment (`thought_relation.relation_type`). */
export async function detectStoredThoughtContradictions(input: {
	userId: string;
	items: RetrievalContextItem[];
}): Promise<ConflictPair[]> {
	const ids = input.items.map((i) => i.id);
	if (ids.length < 2) return [];

	const rows = await getDb()
		.select({
			sourceThoughtId: thoughtRelation.sourceThoughtId,
			targetThoughtId: thoughtRelation.targetThoughtId,
			relationType: thoughtRelation.relationType
		})
		.from(thoughtRelation)
		.where(
			and(
				eq(thoughtRelation.userId, input.userId),
				inArray(thoughtRelation.sourceThoughtId, ids),
				inArray(thoughtRelation.targetThoughtId, ids)
			)
		);

	const idSet = new Set(ids);
	const byId = new Map(input.items.map((i) => [i.id, i]));
	const conflicts: ConflictPair[] = [];

	for (const row of rows) {
		if (!row.relationType.toLowerCase().includes('contradict')) continue;
		if (!idSet.has(row.sourceThoughtId) || !idSet.has(row.targetThoughtId)) continue;
		const a = byId.get(row.sourceThoughtId);
		const b = byId.get(row.targetThoughtId);
		if (!a || !b) continue;
		const topic =
			sharedTopicCluster(a.normalizedText, b.normalizedText) ??
			extractSubjectKey(a.normalizedText).split(' ')[0] ??
			'this topic';
		conflicts.push({
			ids: [row.sourceThoughtId, row.targetThoughtId],
			subject: topic,
			description: `Stored memory links mark these thoughts as contradictory about "${topic}"`
		});
	}

	return conflicts;
}

// ---------------------------------------------------------------------------
// Prompt formatting
// ---------------------------------------------------------------------------

export function formatThoughtsForPrompt(items: RetrievalContextItem[], now: Date): string {
	if (items.length === 0) return '(no thoughts retrieved)';
	return items
		.map((t) => {
			const dateStr = t.createdAt.toISOString().slice(0, 10);
			const staleFlag = t.isStale ? ' ⚠ STALE (>6 months old — may no longer reflect current state)' : '';
			const temporalAnnotation =
				t.temporalStatus !== 'none'
					? `, ${formatTemporalAnnotation(t.temporalEvents, t.temporalStatus, now)}`
					: '';
			const graphLine = t.graphProvenance ? `\nGraph: ${t.graphProvenance}` : '';
			return (
				`${canonicalCitationToken(t.id)} (${t.category}, score=${t.score.toFixed(3)}, stored=${dateStr}${staleFlag}${temporalAnnotation})` +
				`${graphLine}\n${t.normalizedText}`
			);
		})
		.join('\n\n');
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word (or hyphenated) match so hint tokens like "to" do not match inside "today". */
export function thoughtTextMentionsToken(text: string, token: string): boolean {
	const normalized = token.trim().toLowerCase();
	if (normalized.length < 2) return false;
	const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(normalized)}(?:[^a-z0-9]|$)`, 'i');
	return re.test(text);
}

export function questionFocusTokens(question: string): string[] {
	const hintQuery = extractRetrievalHints(question);
	if (!hintQuery) return [];
	return hintQuery.split(/\s+/).filter((t) => t.length >= 2);
}

/** "Who is X" / "Wer ist X" — identity lookup, not broad topic search. */
export function isIdentityLookupQuestion(question: string): boolean {
	return /^(who|wer)\s+(is|ist)\s+\S/i.test(question.trim());
}

/**
 * Person named in a focused fact question (allergy, needs, contact preference, etc.).
 * Returns a lowercase token suitable for lexical/graph anchoring.
 */
export function extractQuestionSubjectName(question: string): string | undefined {
	const trimmed = question.trim();
	const patterns = [
		/^(?:who|wer)\s+(?:is|ist)\s+([A-Za-z][A-Za-z'-]{1,})\b/i,
		/^what\s+is\s+([A-Za-z][A-Za-z'-]{1,})\s+/i,
		/^what\s+does\s+([A-Za-z][A-Za-z'-]{1,})\s+/i,
		/^how\s+(?:do|does|can|should)\s+(?:i|we)\s+(?:reach|contact)\s+([A-Za-z][A-Za-z'-]{1,})\b/i
	];
	for (const pattern of patterns) {
		const match = pattern.exec(trimmed);
		const name = match?.[1]?.replace(/[^A-Za-z'-]/g, '').toLowerCase();
		if (name && name.length >= 2) return name;
	}
	return undefined;
}

export function isPersonFocusedQuestion(question: string): boolean {
	return isIdentityLookupQuestion(question) || extractQuestionSubjectName(question) !== undefined;
}

/** For identity questions, only thoughts that mention the asked-for name belong in the compose prompt. */
export function narrowComposeContextToQuestionFocus(
	question: string,
	items: RetrievalContextItem[]
): RetrievalContextItem[] {
	if (!isPersonFocusedQuestion(question)) return items;
	const subject = extractQuestionSubjectName(question);
	const tokens = subject ? [subject, ...questionFocusTokens(question)] : questionFocusTokens(question);
	const uniqueTokens = [...new Set(tokens)];
	if (uniqueTokens.length === 0) return items;
	const filtered = items.filter((item) =>
		uniqueTokens.some((token) => thoughtTextMentionsToken(item.normalizedText, token))
	);
	if (isIdentityLookupQuestion(question)) return filtered;
	return filtered.length > 0 ? filtered : items;
}

/** Boost thoughts that mention the question's subject person before slicing to topK. */
export function prioritizePersonNamedThoughts(
	question: string,
	items: RetrievalContextItem[],
	topK: number
): RetrievalContextItem[] {
	const subject = extractQuestionSubjectName(question);
	if (!subject) return items.slice(0, topK);
	const mentionsSubject = (item: RetrievalContextItem) =>
		thoughtTextMentionsToken(item.normalizedText, subject);
	const primary = items.filter(mentionsSubject);
	const rest = items.filter((item) => !mentionsSubject(item));
	return [...primary, ...rest].slice(0, topK);
}

function formatConflictsForPrompt(conflicts: ConflictPair[]): string {
	if (conflicts.length === 0) return '';
	const lines = conflicts.map(
		(c) =>
			`  - Thoughts ${canonicalCitationToken(c.ids[0])} and ${canonicalCitationToken(c.ids[1])} may conflict on "${c.subject}": ${c.description}`
	);
	return (
		'\n\nDetected potential contradictions (surface these honestly in your answer rather than picking one side):\n' +
		lines.join('\n')
	);
}

const SYSTEM_PROMPT = [
	'You answer the user question STRICTLY from the provided thoughts.',
	'',
	'Required output format (use these exact section headers in this order):',
	'Answer: <one or two short sentences giving the most direct, decisive answer, using only cited facts>',
	'Evidence:',
	'- <fact> [id=<uuid>]',
	'- <fact> [id=<uuid>]',
	'Unknown:',
	'- <facts the question asked for that are NOT in the thoughts, one per line, or "none">',
	'',
	'Hard rules:',
	'- Cite every factual claim with [id=<uuid>] using the EXACT id string from each thought header (do not invent ids, do not shorten or truncate ids, do not add a "t_" prefix that is not in the id).',
	'- Never cite entry position numbers (e.g. [1], [6]); only cite using [id=<uuid>] copied from the thought header.',
	'- Use only facts that appear verbatim or as a direct paraphrase in the thoughts. Do not add interpretation, do not extrapolate, do not infer motives or job titles.',
	'- Do NOT equate or identify different people or names unless a cited thought explicitly states that link (e.g. "Clemi is Annie"). Similar topics, family, or graph edges are NOT enough.',
	'- If the question names a person, nickname, or entity (e.g. "Clemi"), that name (or an alias written in the thoughts) MUST appear in a cited thought. Otherwise Answer MUST be "Not in memory."',
	'- Do NOT use speculative or hedging language ("appears", "likely", "seems", "suggests", "probably", "may", "might", "could", "I assume") unless that exact uncertainty is stated in a cited thought.',
	'- If the thoughts do not answer the question at all, the Answer line MUST be exactly: "Not in memory." Evidence may be empty; list what was asked for in Unknown.',
	'- For partial answers, put what IS known in Evidence and what is NOT known in Unknown. Do not fill gaps with guesses.',
	'- Every line under Evidence MUST end with at least one [id=<uuid>] citation.',
	'- Keep the response compact. No preamble, no closing remarks, no meta commentary about the thoughts.',
	'',
	'Temporal & staleness rules:',
	'- "STALE (>6 months old)" is age-based: present with storage date and caveat it may be outdated.',
	'- "temporal: … EXPIRED" means the thought\'s time-bound period has ended — do NOT state as current plans',
	'  or present intent. Frame as past: "As of <stored date>, you noted …".',
	'- For questions about now/today/current plans with only EXPIRED temporal evidence, Answer must say current',
	'  status is unknown or not in memory for the present.',
	'- For questions about current state (where do I live, am I happy at work, etc.) with only STALE evidence,',
	'  state explicitly that the most recent memory is from <date> and current status is unknown.',
	'- If two thoughts give conflicting timestamps for the same fact, present the most recent as current and',
	'  note the earlier one as a prior state.',
	'',
	'Contradiction rules:',
	'- If the detected contradictions section is present, you MUST surface the conflict in your answer.',
	'- Do not silently pick one side. Present both views with their storage dates and note the apparent',
	'  contradiction. The user should be aware their stored beliefs conflict.',
	'- If temporal scheduling conflicts from the memory graph are listed, connect the cited thoughts in your Answer.'
].join('\n');

function extractAnswerText(response: unknown): string {
	if (!response || typeof response !== 'object') {
		throw new Error('LLM chat response is not an object');
	}
	const choices = (response as { choices?: unknown }).choices;
	if (!Array.isArray(choices) || choices.length === 0) {
		throw new Error('LLM chat response has no choices');
	}
	const message = (choices[0] as { message?: unknown }).message;
	if (!message || typeof message !== 'object') {
		throw new Error('LLM chat response choice has no message');
	}
	const content = (message as { content?: unknown }).content;
	if (typeof content !== 'string' || content.trim().length === 0) {
		throw new Error('LLM chat response content is empty');
	}
	return content;
}

/** Citation ids present in answer text that are not in the retrieved allow-list. */
export function findInvalidCitationIds(answer: string, allowedIds: Set<string>): string[] {
	const invalid = new Set<string>();
	let match: RegExpExecArray | null;
	const re = new RegExp(CITATION_TOKEN_RE);
	while ((match = re.exec(answer)) !== null) {
		const id = match[1];
		if (!allowedIds.has(id)) invalid.add(id);
	}
	return [...invalid];
}

/** Profile answers only require citations under the Details section. */
export function extractProfileDetailsBlock(answer: string): string {
	const match = answer.match(/^Details:\s*([\s\S]*?)(?=^Themes:|\s*$)/m);
	return match?.[1]?.trim() ?? '';
}

const PROFILE_CITATION_PLACEHOLDERS = new Set(['id']);

/** Validate citations only in the Details block; ignore Summary/Themes bracket noise. */
export function findInvalidProfileCitationIds(answer: string, allowedIds: Set<string>): string[] {
	const details = extractProfileDetailsBlock(answer);
	if (!details) return [];
	return findInvalidCitationIds(details, allowedIds).filter((id) => !PROFILE_CITATION_PLACEHOLDERS.has(id));
}

function extractCitations(answer: string, allowedIds: Set<string>): string[] {
	const seen = new Set<string>();
	let match: RegExpExecArray | null;
	const re = new RegExp(CITATION_TOKEN_RE);
	while ((match = re.exec(answer)) !== null) {
		const id = match[1];
		if (allowedIds.has(id)) seen.add(id);
	}
	return [...seen];
}

function searchHitToContextItem(hit: SearchHit, now: Date): RetrievalContextItem {
	return {
		id: hit.id,
		normalizedText: hit.normalizedText,
		category: hit.category,
		score: hit.score,
		vectorScore: hit.vectorScore,
		graphScore: hit.graphScore,
		createdAt: hit.createdAt,
		isStale: isThoughtStaleByAge({
			createdAt: hit.createdAt,
			now,
			thresholdMs: STALENESS_THRESHOLD_MS,
			memoryType: hit.memoryType as MemoryType | null,
			metadata: hit.metadata
		}),
		graphProvenance:
			typeof hit.metadata?.graphProvenance === 'string' ? hit.metadata.graphProvenance : undefined,
		temporalStatus: 'none',
		temporalEvents: []
	};
}

async function hydrateTemporalContextForThoughts(input: {
	userId: string;
	items: RetrievalContextItem[];
	now: Date;
}): Promise<RetrievalContextItem[]> {
	const thoughtIds = input.items.map((item) => item.id);
	if (thoughtIds.length === 0) return input.items;

	const contextByThoughtId = await loadTemporalContextByThoughtIds({
		userId: input.userId,
		thoughtIds,
		now: input.now
	});

	return input.items.map((item) => {
		const ctx = contextByThoughtId.get(item.id);
		return {
			...item,
			temporalStatus: ctx?.temporalStatus ?? 'none',
			temporalEvents: ctx?.temporalEvents ?? []
		};
	});
}

async function hydrateConflictThoughts(input: {
	userId: string;
	contextItems: RetrievalContextItem[];
	conflictThoughtIds: string[];
	now: Date;
}): Promise<RetrievalContextItem[]> {
	const present = new Set(input.contextItems.map((c) => c.id));
	const missing = input.conflictThoughtIds.filter((id) => !present.has(id));
	if (missing.length === 0) return input.contextItems;

	const rows = await getDb()
		.select({
			id: thought.id,
			normalizedText: thought.normalizedText,
			normalizedTextEncrypted: thought.normalizedTextEncrypted,
			category: thought.category,
			memoryType: thought.memoryType,
			metadata: thought.metadata,
			metadataEncrypted: thought.metadataEncrypted,
			createdAt: thought.createdAt
		})
		.from(thought)
		.where(and(eq(thought.userId, input.userId), inArray(thought.id, missing)));
	const decryptedRows = await Promise.all(
		rows.map(async (row) => {
			const [normalizedText, metadataJson] = await Promise.all([
				row.normalizedTextEncrypted
					? decryptTenantValue({
							userId: input.userId,
							table: 'thought',
							column: 'normalized_text',
							ciphertext: row.normalizedTextEncrypted
						})
					: Promise.resolve(row.normalizedText),
				row.metadataEncrypted
					? decryptTenantValue({
							userId: input.userId,
							table: 'thought',
							column: 'metadata',
							ciphertext: row.metadataEncrypted
						})
					: Promise.resolve(JSON.stringify(row.metadata ?? {}))
			]);
			return { ...row, normalizedText, metadata: JSON.parse(metadataJson) as Record<string, unknown> };
		})
	);

	const hydrated: RetrievalContextItem[] = decryptedRows.map((row) => ({
		id: row.id,
		normalizedText: row.normalizedText,
		category: row.category,
		score: 1,
		vectorScore: 0,
		graphScore: 1,
		createdAt: row.createdAt,
		isStale: isThoughtStaleByAge({
			createdAt: row.createdAt,
			now: input.now,
			thresholdMs: STALENESS_THRESHOLD_MS,
			memoryType: row.memoryType as MemoryType | null,
			metadata: row.metadata
		}),
		graphProvenance: 'temporal:scheduling_conflict',
		temporalStatus: 'none',
		temporalEvents: []
	}));

	return [...input.contextItems, ...hydrated];
}

function prioritizeConflictThoughts(
	items: RetrievalContextItem[],
	conflictThoughtIds: Set<string>,
	topK: number
): RetrievalContextItem[] {
	return [
		...items.filter((c) => conflictThoughtIds.has(c.id)),
		...items.filter((c) => !conflictThoughtIds.has(c.id))
	].slice(0, topK);
}

export async function composeAnswer(input: ComposeAnswerInput): Promise<ComposedAnswer> {
	const trimmedQuestion = input.question.trim();
	if (trimmedQuestion.length === 0) {
		throw new Error('composeAnswer: question must be non-empty');
	}

	const overallStart = Date.now();
	const now = new Date();
	const weights = input.weights ?? CONTEXT_WEIGHTS.default;
	const topK = input.topK ?? 8;
	const retrievalQuery = input.retrievalQuery?.trim() || trimmedQuestion;

	let phaseStart = Date.now();
	console.info('[composeAnswer] phase=embedding start', {
		userId: input.userId,
		question: trimmedQuestion,
		retrievalQuery
	});
	await input.onProgress?.('embedding');
	const queryEmbedding = await createThoughtEmbedding(input.userId, retrievalQuery);
	console.info('[composeAnswer] phase=embedding done', {
		durationMs: Date.now() - phaseStart,
		embeddingCount: 1
	});

	phaseStart = Date.now();
	console.info('[composeAnswer] phase=searching start', { topK, retrievalQuery });
	await input.onProgress?.('searching');
	const retrieved = await searchThoughts({
		userId: input.userId,
		query: retrievalQuery,
		topK,
		weights,
		queryEmbedding
	});
	void tryRecordRetrievalQualityEvent({
		userId: input.userId,
		surface: 'compose_answer',
		weights,
		topKRequested: topK,
		results: retrieved.map((r) => ({ vectorScore: r.vectorScore, graphScore: r.graphScore }))
	});

	const temporalQuery = retrievalQuery;
	const schedulingConflicts = isSchedulingConflictQuery(temporalQuery)
		? await findTemporalSchedulingConflicts({
				userId: input.userId,
				query: temporalQuery
			})
		: [];
	const conflictThoughtIdSet = new Set(schedulingConflicts.flatMap((c) => c.thoughtIds));

	let contextItems = retrieved.map((r) => searchHitToContextItem(r, now));
	contextItems = await hydrateConflictThoughts({
		userId: input.userId,
		contextItems,
		conflictThoughtIds: [...conflictThoughtIdSet],
		now
	});
	contextItems = prioritizeConflictThoughts(contextItems, conflictThoughtIdSet, topK);
	contextItems = prioritizePersonNamedThoughts(trimmedQuestion, contextItems, topK);
	contextItems = narrowComposeContextToQuestionFocus(trimmedQuestion, contextItems);
	contextItems = await hydrateTemporalContextForThoughts({
		userId: input.userId,
		items: contextItems,
		now
	});

	const conflicts = mergeConflictPairs(
		detectContradictions(contextItems),
		await detectStoredThoughtContradictions({ userId: input.userId, items: contextItems })
	);
	console.info('[composeAnswer] phase=searching done', {
		durationMs: Date.now() - phaseStart,
		retrievedCount: retrieved.length,
		contextCount: contextItems.length,
		conflictCount: conflicts.length,
		schedulingConflictCount: schedulingConflicts.length
	});

	const messages: ChatMessage[] = [
		{ role: 'system', content: SYSTEM_PROMPT },
		{
			role: 'user',
			content:
				`Question: ${trimmedQuestion}\n\n` +
				`Thoughts:\n${formatThoughtsForPrompt(contextItems, now)}` +
				formatTemporalConflictsForPrompt(schedulingConflicts) +
				formatConflictsForPrompt(conflicts) +
				`\n\nRespond using the strict format from the system message. Cite ids exactly as written after "id=" above.`
		}
	];
	phaseStart = Date.now();
	console.info('[composeAnswer] phase=composing start', {
		thoughtCount: contextItems.length,
		promptChars: messages.reduce((n, m) => n + m.content.length, 0)
	});
	for (const message of messages) {
		console.log(`[composeAnswer] prompt ${message.role}:\n${message.content}`);
	}
	await input.onProgress?.('composing');
	const response = await llmChatCompletion({
		userId: input.userId,
		messages,
		temperature: 0,
		logContext: 'compose_answer'
	});
	console.info('[composeAnswer] phase=composing done', { durationMs: Date.now() - phaseStart });
	const answer = extractAnswerText(response);
	const allowedIds = new Set(contextItems.map((c) => c.id));
	const invalidCitations = findInvalidCitationIds(answer, allowedIds);
	if (invalidCitations.length > 0) {
		throw new Error(
			`composeAnswer: answer cites thought ids not in retrieved context: ${invalidCitations.join(', ')}`
		);
	}
	const citations = extractCitations(answer, allowedIds);
	console.info('[composeAnswer] done', {
		totalDurationMs: Date.now() - overallStart,
		citationCount: citations.length,
		answerChars: answer.length
	});
	return { answer, citations, retrieved: contextItems, conflicts };
}
