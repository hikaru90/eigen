import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { thought, thoughtRelation } from '$lib/server/db/schema';
import { createThoughtEmbedding } from '$lib/server/llm/embedding';
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client';
import { searchThoughts } from '$lib/server/retrieval/service';
import { searchTextFiles, type TextFileSearchHit } from '$lib/server/text-files/service';
import {
	fetchRelevantCommunitySummaries,
	type RelevantCommunitySummary
} from '$lib/server/retrieval/global';
import { classifyQueryIntent, type TemporalQuestionKind } from '$lib/server/retrieval/classify-query-intent';
import { loadGroundingProfileForEnrichment } from '$lib/server/grounding/profile';
import { groundingProfilePromptBlock } from '$lib/server/grounding/prompt-block';
import {
	mergeQuestionEntityHints,
	shouldUseDeterministicSolverAnswer
} from '$lib/server/retrieval/query-entity-hints';
import {
	candidatesFromTemporalSeeds,
	resolveTemporalHintBindings
} from '$lib/server/retrieval/resolve-temporal-hint-bindings';
import { fetchTemporalEventSeeds, fetchTemporalEventSeedsForHints, type TemporalSeedsFetchResult } from '$lib/server/retrieval/temporal';
import {
	allowsComputedTimelineCitation,
	COMPUTED_TIMELINE_CITATION_ID,
	formatComputedTimelineForPrompt,
	formatSolverAnswer,
	solveTemporalQuestion
} from '$lib/server/qa/temporal-solver';
import { CONTEXT_WEIGHTS } from '$lib/server/retrieval';
import {
	COMPOSE_ANSWER_RELEVANCE_MIN,
	normalizeRetrievalScore
} from '$lib/server/retrieval/rrf-scoring';
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
	normalizeCitationTokens,
	replaceCitationTokens
} from '$lib/chat/citation-tokens';

/** Reserved citation id for explicit user grounding profile facts in compose prompts. */
export const GROUNDING_PROFILE_CITATION_ID = 'profile';

/** Thoughts older than this threshold (in ms) are considered potentially stale. */
const STALENESS_THRESHOLD_MS = 6 * 30 * 24 * 60 * 60 * 1000; // ~6 months
const DEFAULT_COMPOSE_TOP_K = 8;
/** Broader recall for corpus-wide questions (still uses retrieveEvidence + cited compose). */
const GLOBAL_COMPOSE_TOP_K = 16;
const TEMPORAL_COMPOSE_TOP_K = 18;
const TEMPORAL_SOLVER_KINDS: TemporalQuestionKind[] = [
	'ordering',
	'multi_ordering',
	'duration',
	'count',
	'lookback',
	'span'
];

async function fetchTemporalSeedsForCompose(input: {
	userId: string;
	query: string;
	queryEmbedding: number[];
	entityHints: string[];
	kind: TemporalQuestionKind;
	usePerHint: boolean;
}): Promise<TemporalSeedsFetchResult> {
	const seedLimit = input.kind === 'count' ? 100 : 24;
	if (input.usePerHint && input.entityHints.length >= 1) {
		return fetchTemporalEventSeedsForHints({
			userId: input.userId,
			query: input.query,
			queryEmbedding: input.queryEmbedding,
			limit: seedLimit,
			entityHints: input.entityHints,
			kind: input.kind
		});
	}
	return fetchTemporalEventSeeds({
		userId: input.userId,
		query: input.query,
		queryEmbedding: input.queryEmbedding,
		limit: seedLimit,
		entityHints: input.entityHints
	});
}

function shouldUsePerHintTemporalSeeds(kind: TemporalQuestionKind, hintCount: number): boolean {
	return hintCount >= 1 && TEMPORAL_SOLVER_KINDS.includes(kind);
}

export type RetrievalContextItem = {
	id: string;
	normalizedText: string;
	category: string;
	author: 'user' | 'agent';
	authorLabel: string | null;
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
	retrievalPath?: 'local' | 'global';
};

export type ComposeAnswerProgressPhase = 'embedding' | 'searching' | 'composing';

export type ComposeAnswerInput = {
	userId: string;
	question: string;
	/** When set (e.g. eval retrieval probe), also search with this query and merge hits. */
	retrievalQuery?: string;
	topK?: number;
	weights?: { vector: number; graph: number };
	authorFilter?: 'user' | 'agent';
	/** As-of time for temporal validity annotations (defaults to wall clock now). */
	referenceTime?: Date;
	onProgress?: (phase: ComposeAnswerProgressPhase) => void | Promise<void>;
};

/** User-facing text from a composed Q&A result (used when skipping a second agent LLM turn). */
export function formatComposedAnswerForUser(answer: string): string {
	return normalizeCitationTokens(answer.trim());
}

type SearchHit = Awaited<ReturnType<typeof searchThoughts>>[number];

/**
 * XXX REMOVED — stop-word filtered retrieval hint extraction.
 * Second-pass retrieval tokens must be LLM-judged if needed.
 */
export function extractRetrievalHints(_question: string): string | undefined {
	return undefined;
}

/**
 * XXX REMOVED — regex/keyword contradiction detection (polarity, location, topic clusters).
 * Contradictions come from persisted thought_relation rows (LLM ingest) only.
 */
export function detectContradictions(_items: RetrievalContextItem[]): ConflictPair[] {
	return [];
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
		if (row.relationType !== 'contradicts') continue;
		if (!idSet.has(row.sourceThoughtId) || !idSet.has(row.targetThoughtId)) continue;
		conflicts.push({
			ids: [row.sourceThoughtId, row.targetThoughtId],
			subject: 'stored relation',
			description: 'Stored memory links mark these thoughts as contradictory'
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

const TEXT_FILE_COMPOSE_TOP_K = 5;

export function formatTextFilesForPrompt(files: TextFileSearchHit[]): string {
	if (files.length === 0) return '';
	return (
		'\n\nText notes (attached documents — keyword match, no embedding):\n' +
		files
			.map((f) => {
				const dateStr = f.updatedAt.slice(0, 10);
				const title = f.title.trim() || 'Untitled note';
				return `file=${f.id} (${title}, score=${f.lexicalScore.toFixed(3)}, updated=${dateStr})\n${f.preview}`;
			})
			.join('\n\n')
	);
}

/** Non-authoritative thematic hints from consolidation (routing only — not citable evidence). */
export function formatCommunityThemesForPrompt(themes: RelevantCommunitySummary[]): string {
	if (themes.length === 0) return '';
	const lines = themes.map(
		(t, i) => `[theme-${i + 1}] (level ${t.level}) ${t.summaryText.trim()}`
	);
	return (
		'\n\nMemory themes (routing hints only — NOT evidence; cite thoughts or [id=profile]):\n' +
		lines.join('\n')
	);
}

export function formatGroundingProfileForCompose(profileBlock: string): string {
	if (!profileBlock.trim()) return '';
	return (
		`\n\n${profileBlock.trim()}\n` +
		`Cite explicit profile facts with [id=${GROUNDING_PROFILE_CITATION_ID}].`
	);
}

/** Deterministic answer when retrieval and profile provide no composable evidence. */
export function insufficientMemoryAnswer(question: string): string {
	return [
		'Answer: Not in memory.',
		'Evidence:',
		'Unknown:',
		`- ${question.trim()}`
	].join('\n');
}

/** XXX REMOVED — person-focused question regex family and context narrowing heuristics. */
export function thoughtTextMentionsToken(_text: string, _token: string): boolean {
	return false;
}

export function questionFocusTokens(_question: string): string[] {
	return [];
}

export function isIdentityLookupQuestion(_question: string): boolean {
	return false;
}

export function extractQuestionSubjectName(_question: string): string | undefined {
	return undefined;
}

export function isPersonFocusedQuestion(_question: string): boolean {
	return false;
}

export function narrowComposeContextToQuestionFocus(
	_question: string,
	items: RetrievalContextItem[]
): RetrievalContextItem[] {
	return items;
}

export function prioritizePersonNamedThoughts(
	_question: string,
	items: RetrievalContextItem[],
	topK: number
): RetrievalContextItem[] {
	return items.slice(0, topK);
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
	'You answer the user question STRICTLY from the provided retrieved thoughts. When a supplementary user grounding profile is present, you may use it only to clarify or disambiguate facts that are already supported by retrieved thoughts — never as the sole evidence source.',
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
	'- Never cite entry position numbers (e.g. [1], [6], "clusters 3 and 4"); only cite using [id=<uuid>] or [id=profile] as specified below.',
	'- Use only facts that appear verbatim or as a direct paraphrase in the retrieved thoughts. The grounding profile may clarify retrieved facts but must not introduce new claims.',
	'- Do NOT equate or identify different people or names unless a cited thought explicitly states that link (e.g. "Clemi is Annie"). Similar topics, family, or graph edges are NOT enough.',
	'- If the question names a person, nickname, or entity (e.g. "Clemi"), that name (or an alias written in the thoughts) MUST appear in a cited thought. Otherwise Answer MUST be "Not in memory."',
	'- Do NOT use speculative or hedging language ("appears", "likely", "seems", "suggests", "probably", "may", "might", "could", "I assume") unless that exact uncertainty is stated in a cited thought or profile.',
	'- If the retrieved thoughts do not answer the question at all, the Answer line MUST be exactly: "Not in memory." Evidence may be empty; list what was asked for in Unknown.',
	'- For partial answers, put what IS known in Evidence and what is NOT known in Unknown. Do not fill gaps with guesses or synthesize patterns across unrelated clusters.',
	'- Every line under Evidence MUST end with at least one [id=<uuid>] or [id=profile] citation.',
	'- Keep the response compact. No preamble, no closing remarks, no meta commentary about the thoughts or memory themes.',
	'- Memory themes (if present) are routing hints only — never cite them and never treat them as evidence.',
	'',
	'Grounding profile rules (only when retrieved thoughts exist AND a profile section is present):',
	'- Profile facts may clarify or disambiguate retrieved thoughts but must not be the sole basis for an answer.',
	`- Cite profile facts with [id=${GROUNDING_PROFILE_CITATION_ID}] (not a thought uuid).`,
	'- If a thought contradicts the profile on self-knowledge, prefer the retrieved thought with its date in Evidence.',
	'',
	'Temporal & staleness rules:',
	'- "STALE (>6 months old)" is age-based: present with storage date and caveat it may be outdated.',
	'- "temporal: … EXPIRED" means the thought\'s time-bound period has ended relative to the reference time.',
	'- For questions about past events, ordering, elapsed time, or "when did X happen", EXPIRED is expected —',
	'  use those dates as authoritative historical facts in your Answer.',
	'- For present-tense / now / current plans questions with only EXPIRED evidence, Answer must say current',
	'  status is unknown or not in memory for the present.',
	'- Do NOT state EXPIRED past events as current plans or present intent.',
	'- For questions about current state (where do I live, am I happy at work, etc.) with only STALE evidence,',
	'  state explicitly that the most recent memory is from <date> and current status is unknown.',
	'- If two thoughts give conflicting timestamps for the same fact, present the most recent as current and',
	'  note the earlier one as a prior state.',
	'- Do not use [id=computed] unless a "Computed timeline" section appears in the user message.',
	'',
	'Contradiction rules:',
	'- If the detected contradictions section is present, you MUST surface the conflict in your answer.',
	'- Do not silently pick one side. Present both views with their storage dates and note the apparent',
	'  contradiction. The user should be aware their stored beliefs conflict.',
	'- If temporal scheduling conflicts from the memory graph are listed, connect the cited thoughts in your Answer.'
].join('\n');

const COMPUTED_TIMELINE_PROMPT_SUFFIX = [
	'Computed timeline rules (only when that section is present in the user message):',
	'- Answer MUST follow the Computed timeline for event ordering and day counts.',
	`- Cite solver-derived ordering or day-count facts with [id=${COMPUTED_TIMELINE_CITATION_ID}] (not a thought uuid).`
].join('\n');

function buildComposeSystemPrompt(allowComputedCitation: boolean): string {
	if (!allowComputedCitation) return SYSTEM_PROMPT;
	return `${SYSTEM_PROMPT}\n\n${COMPUTED_TIMELINE_PROMPT_SUFFIX}`;
}

function stripDisallowedComputedCitations(answer: string): string {
	return replaceCitationTokens(answer, (id, match) =>
		id === COMPUTED_TIMELINE_CITATION_ID ? '' : match
	);
}

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
		author: hit.author,
		authorLabel: hit.authorLabel,
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
	const now = input.referenceTime ?? new Date();
	const weights = input.weights ?? CONTEXT_WEIGHTS.default;
	const retrievalQuery = input.retrievalQuery?.trim() || trimmedQuestion;
	const queryIntent = await classifyQueryIntent({ userId: input.userId, query: trimmedQuestion });
	const entityHints = mergeQuestionEntityHints(queryIntent.entityHints);
	const scope = queryIntent.scope;
	const retrievalPath: ComposedAnswer['retrievalPath'] = scope === 'global' ? 'global' : 'local';
	const effectiveTopK =
		input.topK ??
		(queryIntent.temporal
			? TEMPORAL_COMPOSE_TOP_K
			: scope === 'global'
				? GLOBAL_COMPOSE_TOP_K
				: DEFAULT_COMPOSE_TOP_K);

	const groundingProfile = await loadGroundingProfileForEnrichment(input.userId);
	const profilePromptBlock = groundingProfilePromptBlock(groundingProfile);
	const hasGroundingProfile = profilePromptBlock.trim().length > 0;

	let phaseStart = Date.now();
	console.info('[composeAnswer] phase=embedding start', {
		userId: input.userId,
		question: trimmedQuestion,
		retrievalQuery,
		retrievalPath,
		hasGroundingProfile
	});
	await input.onProgress?.('embedding');
	const queryEmbedding = await createThoughtEmbedding(input.userId, retrievalQuery);
	console.info('[composeAnswer] phase=embedding done', {
		durationMs: Date.now() - phaseStart,
		embeddingCount: 1
	});

	phaseStart = Date.now();
	console.info('[composeAnswer] phase=searching start', {
		topK: effectiveTopK,
		retrievalQuery,
		temporal: queryIntent.temporal,
		temporalKind: queryIntent.kind
	});
	await input.onProgress?.('searching');
	const communityThemesPromise =
		scope === 'global'
			? fetchRelevantCommunitySummaries({
					userId: input.userId,
					queryEmbedding,
					limit: 6
				})
			: Promise.resolve([]);
	const [searchResults, textFileHits, communityThemes] = await Promise.all([
		searchThoughts({
			userId: input.userId,
			query: retrievalQuery,
			topK: effectiveTopK,
			weights,
			queryEmbedding,
			temporalIntent: queryIntent,
			authorFilter: input.authorFilter
		}),
		searchTextFiles(input.userId, { query: retrievalQuery, topK: TEXT_FILE_COMPOSE_TOP_K }),
		communityThemesPromise
	]);
	const retrieved = searchResults.filter(
		(r) => normalizeRetrievalScore(r.score) >= COMPOSE_ANSWER_RELEVANCE_MIN
	);
	void tryRecordRetrievalQualityEvent({
		userId: input.userId,
		surface: 'compose_answer',
		weights,
		topKRequested: effectiveTopK,
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
	contextItems = prioritizeConflictThoughts(contextItems, conflictThoughtIdSet, effectiveTopK);
	contextItems = prioritizePersonNamedThoughts(trimmedQuestion, contextItems, effectiveTopK);
	contextItems = narrowComposeContextToQuestionFocus(trimmedQuestion, contextItems);
	contextItems = await hydrateTemporalContextForThoughts({
		userId: input.userId,
		items: contextItems,
		now
	});

	const temporalFetch =
		queryIntent.temporal && TEMPORAL_SOLVER_KINDS.includes(queryIntent.kind)
			? await fetchTemporalSeedsForCompose({
					userId: input.userId,
					query: retrievalQuery,
					queryEmbedding,
					entityHints,
					kind: queryIntent.kind,
					usePerHint: shouldUsePerHintTemporalSeeds(queryIntent.kind, entityHints.length)
				})
			: { seeds: [], candidatesByHint: [] };
	const temporalSeeds = temporalFetch.seeds;
	const hintBindings =
		entityHints.length > 0 && temporalSeeds.length > 0
			? await resolveTemporalHintBindings({
					userId: input.userId,
					question: trimmedQuestion,
					kind: queryIntent.kind,
					hints: entityHints,
					candidates: candidatesFromTemporalSeeds(temporalSeeds),
					candidatesByHint: temporalFetch.candidatesByHint
				})
			: [];
	let solverResult = solveTemporalQuestion({
		kind: queryIntent.kind,
		entityHints,
		seeds: temporalSeeds,
		hintBindings,
		referenceTime: now,
		durationUnit: queryIntent.durationUnit
	});
	if (
		solverResult.confidence === 'low' &&
		entityHints.length >= 1 &&
		temporalSeeds.length > 0
	) {
		const retryFetch = await fetchTemporalSeedsForCompose({
			userId: input.userId,
			query: retrievalQuery,
			queryEmbedding,
			entityHints,
			kind: queryIntent.kind,
			usePerHint: true
		});
		const retrySeeds = retryFetch.seeds;
		const retryBindings = await resolveTemporalHintBindings({
			userId: input.userId,
			question: trimmedQuestion,
			kind: queryIntent.kind,
			hints: entityHints,
			candidates: candidatesFromTemporalSeeds(retrySeeds),
			candidatesByHint: retryFetch.candidatesByHint
		});
		const retryResult = solveTemporalQuestion({
			kind: queryIntent.kind,
			entityHints,
			seeds: retrySeeds,
			hintBindings: retryBindings,
			referenceTime: now,
			durationUnit: queryIntent.durationUnit
		});
		if (retryResult.confidence === 'high') {
			solverResult = retryResult;
		}
	}
	const computedTimelineBlock = formatComputedTimelineForPrompt(solverResult);
	const deterministicAnswer = shouldUseDeterministicSolverAnswer({
		intentKind: queryIntent.kind,
		solverResult,
		comparativeOrdering: queryIntent.comparativeOrdering
	})
		? formatSolverAnswer(solverResult)
		: null;

	const conflicts = mergeConflictPairs(
		detectContradictions(contextItems),
		await detectStoredThoughtContradictions({ userId: input.userId, items: contextItems })
	);
	console.info('[composeAnswer] phase=searching done', {
		durationMs: Date.now() - phaseStart,
		retrievedCount: retrieved.length,
		textFileCount: textFileHits.length,
		contextCount: contextItems.length,
		conflictCount: conflicts.length,
		schedulingConflictCount: schedulingConflicts.length,
		temporalSolverKind: solverResult.kind,
		temporalSolverConfidence: solverResult.confidence,
		temporalSeedCount: temporalSeeds.length,
		temporalEntityHintCount: entityHints.length,
		temporalBypassUsed: Boolean(deterministicAnswer)
	});

	const allowComputedCitation = allowsComputedTimelineCitation(solverResult);
	const allowedIds = new Set(contextItems.map((c) => c.id));
	if (allowComputedCitation) {
		allowedIds.add(COMPUTED_TIMELINE_CITATION_ID);
	}
	for (const event of solverResult.events) {
		allowedIds.add(event.thoughtId);
	}

	const profileBlock = formatGroundingProfileForCompose(profilePromptBlock);
	const communityThemeBlock = formatCommunityThemesForPrompt(communityThemes);
	const hasRetrievedEvidence = contextItems.length > 0 || textFileHits.length > 0;
	const hasComposableEvidence = hasRetrievedEvidence;
	if (hasRetrievedEvidence && hasGroundingProfile) {
		allowedIds.add(GROUNDING_PROFILE_CITATION_ID);
	}

	let answer: string;
	if (deterministicAnswer) {
		console.info('[composeAnswer] phase=composing skipped — deterministic temporal solver answer');
		await input.onProgress?.('composing');
		answer = deterministicAnswer;
	} else if (!hasComposableEvidence) {
		console.info('[composeAnswer] phase=composing skipped — no retrieved thoughts or text files');
		await input.onProgress?.('composing');
		answer = insufficientMemoryAnswer(trimmedQuestion);
	} else {
		const messages: ChatMessage[] = [
			{ role: 'system', content: buildComposeSystemPrompt(allowComputedCitation) },
			{
				role: 'user',
				content:
					`Question: ${trimmedQuestion}\n\n` +
					profileBlock +
					`Thoughts:\n${formatThoughtsForPrompt(contextItems, now)}` +
					formatTextFilesForPrompt(textFileHits) +
					communityThemeBlock +
					computedTimelineBlock +
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
		answer = extractAnswerText(response);
	}
	const invalidCitations = findInvalidCitationIds(answer, allowedIds);
	if (
		invalidCitations.length > 0 &&
		invalidCitations.every((id) => id === COMPUTED_TIMELINE_CITATION_ID)
	) {
		console.warn(
			'[composeAnswer] stripping disallowed computed timeline citations from LLM answer'
		);
		answer = stripDisallowedComputedCitations(answer);
	} else if (invalidCitations.length > 0) {
		throw new Error(
			`composeAnswer: answer cites thought ids not in retrieved context: ${invalidCitations.join(', ')}`
		);
	}
	const citations = extractCitations(answer, allowedIds);
	const citedIds = new Set(citations);
	console.info('[composeAnswer] done', {
		totalDurationMs: Date.now() - overallStart,
		citationCount: citations.length,
		answerChars: answer.length,
		retrievalPath
	});
	return {
		answer,
		citations,
		retrieved: contextItems.filter((c) => citedIds.has(c.id)),
		conflicts,
		retrievalPath
	};
}
