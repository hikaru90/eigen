import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client';
import { searchThoughts } from '$lib/server/retrieval/service';
import { CONTEXT_WEIGHTS } from '$lib/server/retrieval';
import { tryRecordRetrievalQualityEvent } from '$lib/server/retrieval/quality-telemetry';

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
	topK?: number;
	weights?: { vector: number; graph: number };
};

// ---------------------------------------------------------------------------
// Contradiction detection
// ---------------------------------------------------------------------------

/**
 * Heuristic contradiction detection over a set of retrieved thoughts.
 *
 * Groups thoughts by a loose "subject key" (first 4 meaningful tokens of the
 * normalized text) and then applies simple opposing-signal patterns:
 *
 *   - Positive/negative polarity pairs on the same topic
 *   - Location/identity update pairs ("I live in X" then "I live in Y")
 *   - Explicit contradicting verbs ("love"/"hate", "great"/"terrible", etc.)
 *
 * This is intentionally cheap — the LLM judge is the final arbiter. The goal
 * is to surface likely conflicts as a context hint so the LLM can flag them
 * in the answer rather than silently picking one side.
 *
 * No LLM call, no hard failure. Returns an empty array if nothing found.
 */

const POLARITY_POSITIVE = /\b(love|great|excellent|amazing|wonderful|perfect|fantastic|good|enjoy|like)\b/i;
const POLARITY_NEGATIVE = /\b(hate|terrible|awful|horrible|dreadful|bad|dislike|can't stand|waste)\b/i;
const LOCATION_PATTERN = /\b(?:live|living|moved|move)\s+(?:in|to)\s+([A-Z][a-zA-Z]+)/;
const DECISION_PATTERN = /\b(?:decided|going|plan|switch|chose|use|using)\s+(?:to\s+)?([a-zA-Z]+)/i;

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

	// 1. Location/identity update pairs
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
		// Sort by date, take first and last if locations differ
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

	// 2. Polarity pairs — thoughts about the same subject with opposite sentiment
	for (let i = 0; i < items.length; i++) {
		for (let j = i + 1; j < items.length; j++) {
			const a = items[i];
			const b = items[j];
			const aPos = POLARITY_POSITIVE.test(a.normalizedText);
			const aNeg = POLARITY_NEGATIVE.test(a.normalizedText);
			const bPos = POLARITY_POSITIVE.test(b.normalizedText);
			const bNeg = POLARITY_NEGATIVE.test(b.normalizedText);

			if (!((aPos && bNeg) || (aNeg && bPos))) continue;

			// Only flag if they share a meaningful subject word
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

	// Deduplicate by id pair
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

function formatThoughtsForPrompt(items: RetrievalContextItem[], now: Date): string {
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
].join('\n');

// ---------------------------------------------------------------------------
// Response parsing helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compose a grounded answer to `question` from the user's stored thoughts.
 *
 * Enhancements over the basic RAG path:
 *   - Retrieved thoughts are annotated with their storage date and a staleness flag
 *     (>6 months old) which is injected into the prompt so the LLM can present
 *     temporal context rather than asserting stale facts as current.
 *   - A lightweight contradiction-detection pass runs over the retrieved thoughts.
 *     Detected conflict pairs are injected into the prompt so the LLM surfaces
 *     them rather than silently picking one side.
 *
 * Inherits the 3-retry no-fallback semantics from `llmChatCompletion`.
 */
export async function composeAnswer(input: ComposeAnswerInput): Promise<ComposedAnswer> {
	const trimmedQuestion = input.question.trim();
	if (trimmedQuestion.length === 0) {
		throw new Error('composeAnswer: question must be non-empty');
	}
	const now = new Date();
	const weights = input.weights ?? CONTEXT_WEIGHTS.default;
	const topK = input.topK ?? 8;
	const retrieved = await searchThoughts({
		userId: input.userId,
		query: trimmedQuestion,
		topK,
		weights
	});
	void tryRecordRetrievalQualityEvent({
		userId: input.userId,
		surface: 'compose_answer',
		weights,
		topKRequested: topK,
		results: retrieved.map((r) => ({ vectorScore: r.vectorScore, graphScore: r.graphScore }))
	});
	const contextItems: RetrievalContextItem[] = retrieved.map((r) => ({
		id: r.id,
		normalizedText: r.normalizedText,
		category: r.category,
		score: r.score,
		vectorScore: r.vectorScore,
		graphScore: r.graphScore,
		createdAt: r.createdAt,
		isStale: now.getTime() - r.createdAt.getTime() > STALENESS_THRESHOLD_MS,
		graphProvenance:
			typeof r.metadata?.graphProvenance === 'string' ? r.metadata.graphProvenance : undefined
	}));

	const conflicts = detectContradictions(contextItems);

	const messages: ChatMessage[] = [
		{ role: 'system', content: SYSTEM_PROMPT },
		{
			role: 'user',
			content:
				`Question: ${trimmedQuestion}\n\n` +
				`Thoughts:\n${formatThoughtsForPrompt(contextItems, now)}` +
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
