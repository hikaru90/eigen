import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { thought, thoughtRelation } from '$lib/server/db/schema';
import { createThoughtEmbedding } from '$lib/server/llm/embedding';
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client';
import { searchThoughts } from '$lib/server/retrieval/service';
import { hasCommunitySummaries, searchGlobal, type GlobalSearchResult } from '$lib/server/retrieval/global';
import { classifyQueryIntent } from '$lib/server/retrieval/classify-query-intent';
import { fetchTemporalEventSeeds } from '$lib/server/retrieval/temporal';
import {
	formatComputedTimelineForPrompt,
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
	normalizeCitationTokens
} from '$lib/chat/citation-tokens';

/** Thoughts older than this threshold (in ms) are considered potentially stale. */
const STALENESS_THRESHOLD_MS = 6 * 30 * 24 * 60 * 60 * 1000; // ~6 months
const DEFAULT_COMPOSE_TOP_K = 8;
const TEMPORAL_COMPOSE_TOP_K = 18;

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

export type GlobalSource = {
	communityId: string;
	level: number;
	summaryExcerpt: string;
};

export type ComposedAnswer = {
	answer: string;
	citations: string[];
	retrieved: RetrievalContextItem[];
	/** Contradiction pairs detected among retrieved thoughts, if any. */
	conflicts: ConflictPair[];
	/** Present when searchGlobal was used (AC-025). */
	globalSources?: GlobalSource[];
	retrievalPath?: 'local' | 'global' | 'global_fallback';
};

export type ComposeAnswerProgressPhase = 'embedding' | 'searching' | 'composing';

export type ComposeAnswerInput = {
	userId: string;
	question: string;
	/** When set (e.g. eval retrieval probe), also search with this query and merge hits. */
	retrievalQuery?: string;
	topK?: number;
	weights?: { vector: number; graph: number };
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
	'- When a Computed timeline section is present, Answer MUST follow it for event ordering and day counts.',
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

function globalSearchResultToComposed(result: GlobalSearchResult): ComposedAnswer {
	return {
		answer: formatComposedAnswerForUser(result.answer),
		citations: [],
		retrieved: [],
		conflicts: [],
		globalSources: result.sources,
		retrievalPath: 'global'
	};
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
	const scope = queryIntent.scope;
	const effectiveTopK =
		input.topK ?? (queryIntent.temporal ? TEMPORAL_COMPOSE_TOP_K : DEFAULT_COMPOSE_TOP_K);
	let retrievalPath: ComposedAnswer['retrievalPath'] = scope === 'global' ? 'global_fallback' : 'local';

	if (scope === 'global') {
		if (await hasCommunitySummaries(input.userId)) {
			console.info('[composeAnswer] path=global start', {
				userId: input.userId,
				question: trimmedQuestion
			});
			await input.onProgress?.('searching');
			const phaseStart = Date.now();
			const global = await searchGlobal({ userId: input.userId, query: trimmedQuestion });
			await input.onProgress?.('composing');
			console.info('[composeAnswer] path=global done', {
				durationMs: Date.now() - phaseStart,
				totalDurationMs: Date.now() - overallStart,
				communitiesUsed: global.communitiesUsed
			});
			return globalSearchResultToComposed(global);
		}
		console.info('[composeAnswer] path=global_fallback: no community summaries', {
			userId: input.userId,
			question: trimmedQuestion
		});
	}

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
	console.info('[composeAnswer] phase=searching start', {
		topK: effectiveTopK,
		retrievalQuery,
		temporal: queryIntent.temporal,
		temporalKind: queryIntent.kind
	});
	await input.onProgress?.('searching');
	const searchResults = await searchThoughts({
		userId: input.userId,
		query: retrievalQuery,
		topK: effectiveTopK,
		weights,
		queryEmbedding,
		temporalIntent: queryIntent
	});
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

	const temporalSeeds =
		queryIntent.temporal && (queryIntent.kind === 'ordering' || queryIntent.kind === 'duration')
			? await fetchTemporalEventSeeds({
					userId: input.userId,
					query: retrievalQuery,
					queryEmbedding,
					limit: 24
				})
			: [];
	const solverResult = solveTemporalQuestion({
		kind: queryIntent.kind,
		entityHints: queryIntent.entityHints,
		seeds: temporalSeeds
	});
	const computedTimelineBlock = formatComputedTimelineForPrompt(solverResult);

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
	const answer = extractAnswerText(response);
	const allowedIds = new Set(contextItems.map((c) => c.id));
	const invalidCitations = findInvalidCitationIds(answer, allowedIds);
	if (invalidCitations.length > 0) {
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
