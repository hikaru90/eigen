import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { thought } from '$lib/server/db/schema';
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client';
import { searchThoughts } from '$lib/server/retrieval/service';
import { CONTEXT_WEIGHTS } from '$lib/server/retrieval';
import { tryRecordRetrievalQualityEvent } from '$lib/server/retrieval/quality-telemetry';
import {
	findTemporalSchedulingConflicts,
	formatTemporalConflictsForPrompt,
	isSchedulingConflictQuery
} from '$lib/server/retrieval/temporal-conflicts';

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
	/** Optional Falkor/entity path hint from hybrid retrieval. */
	graphProvenance?: string;
	/** True when the thought was stored more than 6 months ago. */
	isStale: boolean;
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

export type ComposeAnswerInput = {
	userId: string;
	question: string;
	/** When set (e.g. eval retrieval probe), also search with this query and merge hits. */
	retrievalQuery?: string;
	topK?: number;
	weights?: { vector: number; graph: number };
};

type SearchHit = Awaited<ReturnType<typeof searchThoughts>>;

function mergeSearchHits(a: SearchHit[], b: SearchHit[], topK: number): SearchHit[] {
	const byId = new Map<string, SearchHit>();
	for (const hit of [...a, ...b]) {
		const existing = byId.get(hit.id);
		if (!existing || hit.score > existing.score) {
			byId.set(hit.id, hit);
		}
	}
	return [...byId.values()].sort((x, y) => y.score - x.score).slice(0, topK);
}

// ---------------------------------------------------------------------------
// Contradiction detection (sentiment / location updates — not scheduling)
// ---------------------------------------------------------------------------

const POLARITY_POSITIVE = /\b(love|great|excellent|amazing|wonderful|perfect|fantastic|good|enjoy|like)\b/i;
const POLARITY_NEGATIVE = /\b(hate|terrible|awful|horrible|dreadful|bad|dislike|can't stand|waste)\b/i;
const LOCATION_PATTERN = /\b(?:live|living|moved|move)\s+(?:in|to)\s+([A-Z][a-zA-Z]+)/;

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
			if (shared.length < 1) continue;

			conflicts.push({
				ids: [a.id, b.id],
				subject: shared[0],
				description: `These thoughts appear to hold opposing views about "${shared[0]}"`
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

// ---------------------------------------------------------------------------
// Prompt formatting
// ---------------------------------------------------------------------------

function formatThoughtsForPrompt(items: RetrievalContextItem[]): string {
	if (items.length === 0) return '(no thoughts retrieved)';
	return items
		.map((t, i) => {
			const dateStr = t.createdAt.toISOString().slice(0, 10);
			const staleFlag = t.isStale ? ' ⚠ STALE (>6 months old — may no longer reflect current state)' : '';
			const graphLine = t.graphProvenance ? `\nGraph: ${t.graphProvenance}` : '';
			return (
				`#${i + 1} [id=${t.id}] (${t.category}, score=${t.score.toFixed(3)}, stored=${dateStr}${staleFlag})` +
				`${graphLine}\n${t.normalizedText}`
			);
		})
		.join('\n\n');
}

function formatConflictsForPrompt(conflicts: ConflictPair[]): string {
	if (conflicts.length === 0) return '';
	const lines = conflicts.map(
		(c) => `  - Thoughts [${c.ids[0]}] and [${c.ids[1]}] may conflict on "${c.subject}": ${c.description}`
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
	'- <fact> [<id>]',
	'- <fact> [<id>]',
	'Unknown:',
	'- <facts the question asked for that are NOT in the thoughts, one per line, or "none">',
	'',
	'Hard rules:',
	'- Cite every factual claim with [<id>] using the EXACT id string from the thoughts list (do not invent ids, do not shorten or truncate ids, do not add a "t_" prefix that is not in the id).',
	'- Use only facts that appear verbatim or as a direct paraphrase in the thoughts. Do not add interpretation, do not extrapolate, do not infer motives or job titles.',
	'- Do NOT use speculative or hedging language ("appears", "likely", "seems", "suggests", "probably", "may", "might", "could", "I assume") unless that exact uncertainty is stated in a cited thought.',
	'- If the thoughts do not answer the question at all, the Answer line MUST be exactly: "Not in memory." Evidence may be empty; list what was asked for in Unknown.',
	'- For partial answers, put what IS known in Evidence and what is NOT known in Unknown. Do not fill gaps with guesses.',
	'- Every line under Evidence MUST end with at least one [<id>] citation.',
	'- Keep the response compact. No preamble, no closing remarks, no meta commentary about the thoughts.',
	'',
	'Temporal & staleness rules:',
	'- Thoughts marked "STALE (>6 months old)" must be presented with their date and a clear caveat that',
	'  this may no longer reflect current reality (e.g. "As of <date>, you noted …; this may be outdated.").',
	'- For questions about current state (where do I live, am I happy at work, etc.) with only stale evidence,',
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

const CITATION_PATTERN = /\[([A-Za-z0-9_-]+)\]/g;

function extractCitations(answer: string, allowedIds: Set<string>): string[] {
	const seen = new Set<string>();
	let match: RegExpExecArray | null;
	const re = new RegExp(CITATION_PATTERN);
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
		isStale: now.getTime() - hit.createdAt.getTime() > STALENESS_THRESHOLD_MS,
		graphProvenance:
			typeof hit.metadata?.graphProvenance === 'string' ? hit.metadata.graphProvenance : undefined
	};
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
			category: thought.category,
			metadata: thought.metadata,
			createdAt: thought.createdAt
		})
		.from(thought)
		.where(and(eq(thought.userId, input.userId), inArray(thought.id, missing)));

	const hydrated: RetrievalContextItem[] = rows.map((row) => ({
		id: row.id,
		normalizedText: row.normalizedText,
		category: row.category,
		score: 1,
		vectorScore: 0,
		graphScore: 1,
		createdAt: row.createdAt,
		isStale: input.now.getTime() - row.createdAt.getTime() > STALENESS_THRESHOLD_MS,
		graphProvenance: 'temporal:scheduling_conflict'
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
	const now = new Date();
	const weights = input.weights ?? CONTEXT_WEIGHTS.default;
	const topK = input.topK ?? 8;
	const retrievalQuery = input.retrievalQuery?.trim();
	let retrieved: SearchHit[];
	if (retrievalQuery && retrievalQuery !== trimmedQuestion) {
		const [fromQuestion, fromRetrievalQuery] = await Promise.all([
			searchThoughts({
				userId: input.userId,
				query: trimmedQuestion,
				topK,
				weights
			}),
			searchThoughts({
				userId: input.userId,
				query: retrievalQuery,
				topK,
				weights
			})
		]);
		retrieved = mergeSearchHits(fromQuestion, fromRetrievalQuery, topK);
	} else {
		retrieved = await searchThoughts({
			userId: input.userId,
			query: retrievalQuery || trimmedQuestion,
			topK,
			weights
		});
	}
	void tryRecordRetrievalQualityEvent({
		userId: input.userId,
		surface: 'compose_answer',
		weights,
		topKRequested: topK,
		results: retrieved.map((r) => ({ vectorScore: r.vectorScore, graphScore: r.graphScore }))
	});

	const temporalQuery = [trimmedQuestion, retrievalQuery].filter(Boolean).join(' ');
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

	const conflicts = detectContradictions(contextItems);

	const messages: ChatMessage[] = [
		{ role: 'system', content: SYSTEM_PROMPT },
		{
			role: 'user',
			content:
				`Question: ${trimmedQuestion}\n\n` +
				`Thoughts:\n${formatThoughtsForPrompt(contextItems)}` +
				formatTemporalConflictsForPrompt(schedulingConflicts) +
				formatConflictsForPrompt(conflicts) +
				`\n\nRespond using the strict format from the system message. Cite ids exactly as written after "id=" above.`
		}
	];
	const response = await llmChatCompletion({
		userId: input.userId,
		messages,
		temperature: 0
	});
	const answer = extractAnswerText(response);
	const allowedIds = new Set(contextItems.map((c) => c.id));
	const citations = extractCitations(answer, allowedIds);
	return { answer, citations, retrieved: contextItems, conflicts };
}
