/**
 * LLM-as-judge for answer-quality evals.
 *
 * Four-axis rubric (from the golden baseline eval framework):
 *
 *   accuracy     (1..5, weight 0.40): Are retrieved/synthesized facts correct?
 *   calibration  (1..5, weight 0.25): Is confidence appropriately expressed?
 *                                     Does the system know what it doesn't know?
 *   completeness (1..5, weight 0.20): Is all relevant stored information surfaced?
 *   tone         (1..5, weight 0.15): Is the response framed usefully, not
 *                                     intrusively or clinically?
 *
 * Weighted final score = accuracy*0.40 + calibration*0.25 + completeness*0.20 + tone*0.15
 * Score label mapping (0–3 document rubric → 1–5 internal scale):
 *   5 = Excellent (3): exceeds expectation, handles edge cases gracefully
 *   4 = Pass+    (2.5): solid pass, minor gaps only
 *   3 = Pass     (2):  meets the behaviour described in the golden standard
 *   2 = Partial  (1):  correct intent but meaningfully incomplete or miscalibrated
 *   1 = Fail     (0):  wrong, confabulated, misleading, or missing entirely
 *
 * Uses temperature 0 and a strict JSON output contract for determinism.
 * Inherits the 3-retry no-fallback semantics of `llmChatCompletion`.
 *
 * Judge calls go through `logActivityCall` as a side effect of `llmChatCompletion`,
 * so judge spend is queryable on the activity log under EVAL_JUDGE_USER_ID.
 */
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client';
import { EVAL_JUDGE_USER_ID } from './eval-config';

export type JudgeCriterionScore = {
	score: 1 | 2 | 3 | 4 | 5;
	rationale: string;
};

export type JudgeVerdict = {
	accuracy: JudgeCriterionScore;
	calibration: JudgeCriterionScore;
	completeness: JudgeCriterionScore;
	tone: JudgeCriterionScore;
	/** Weighted composite: accuracy*0.40 + calibration*0.25 + completeness*0.20 + tone*0.15 */
	weightedScore: number;
};

export type JudgeInput = {
	question: string;
	answer: string;
	citations: string[];
	thoughts: Array<{ id: string; normalizedText: string; createdAt?: Date }>;
	/** Optional dimension name for context — included in judge prompt if provided. */
	dimension?: string;
};

const WEIGHTS = {
	accuracy: 0.4,
	calibration: 0.25,
	completeness: 0.2,
	tone: 0.15
} as const;

const SYSTEM_PROMPT = [
	'You are an expert evaluator judging the quality of a second-brain memory system answer.',
	'You will be given:',
	'  - the user question',
	'  - the candidate answer',
	'  - the thoughts that were retrieved as context (with stable ids and optional timestamps)',
	'  - the ids the answer cites',
	'',
	'Score the answer on FOUR criteria using whole integers 1..5:',
	'',
	'  accuracy     -- every factual claim is supported by the provided thoughts and is correct',
	'                  5 = fully grounded and accurate; 1 = mostly hallucinated or wrong',
	'',
	'  calibration  -- confidence is appropriately expressed; the system knows what it does and',
	'                  does not know; contradictions are surfaced when present; stale facts are',
	'                  flagged rather than asserted as current',
	'                  5 = perfectly calibrated; 1 = wildly over-confident or refuses to engage',
	'',
	'  completeness -- all relevant stored information is surfaced; nothing important is omitted',
	'                  5 = complete; 1 = critically incomplete',
	'',
	'  tone         -- the response is framed usefully; not intrusive, not clinical, not preachy',
	'                  5 = ideal framing; 1 = unhelpful or inappropriate framing',
	'',
	'Score label reference (for your own guidance, not output):',
	'  5 = Excellent: exceeds expectation, handles edge cases gracefully',
	'  4 = Pass+:     solid pass, only minor gaps',
	'  3 = Pass:      meets the expected behaviour',
	'  2 = Partial:   correct intent but meaningfully incomplete or miscalibrated',
	'  1 = Fail:      wrong, confabulated, misleading, or missing entirely',
	'',
	'ANTI-PATTERNS that must cause a score of 1 on the relevant axis:',
	'  - Confabulation: presenting inferred content as stored memory (accuracy=1)',
	'  - Stale-fact assertion: claiming an old memory is current without a staleness flag (calibration=1)',
	'  - Silent disambiguation: picking among ambiguous options without disclosing it (calibration=1)',
	'  - False certainty about feelings/internal states from limited evidence (calibration=1)',
	'  - Forgetting an explicit deletion request if one is mentioned (accuracy=1)',
	'  - Scope leakage: answering from outside a stated scoped context (accuracy=1)',
	'',
	'Return strictly valid JSON with this exact shape, no prose, no markdown:',
	'{',
	'  "accuracy":     { "score": <1-5 int>, "rationale": "<one sentence>" },',
	'  "calibration":  { "score": <1-5 int>, "rationale": "<one sentence>" },',
	'  "completeness": { "score": <1-5 int>, "rationale": "<one sentence>" },',
	'  "tone":         { "score": <1-5 int>, "rationale": "<one sentence>" }',
	'}',
	'Do not include any other keys. Do not wrap the JSON in code fences.'
].join('\n');

function formatThoughts(thoughts: JudgeInput['thoughts']): string {
	if (thoughts.length === 0) return '(none retrieved)';
	return thoughts
		.map((t) => {
			const ts = t.createdAt ? ` [stored: ${t.createdAt.toISOString().slice(0, 10)}]` : '';
			return `[id=${t.id}]${ts} ${t.normalizedText}`;
		})
		.join('\n');
}

function buildUserMessage(input: JudgeInput): string {
	const cited = input.citations.length > 0 ? input.citations.join(', ') : '(none)';
	const dimNote = input.dimension ? `\nCapability dimension being tested: ${input.dimension}\n` : '';
	return [
		`${dimNote}Question:\n${input.question}`,
		`Answer:\n${input.answer}`,
		`Citations in answer: ${cited}`,
		`Retrieved thoughts:\n${formatThoughts(input.thoughts)}`
	].join('\n\n');
}

function parseJsonContent(content: string): unknown {
	const trimmed = content.trim();
	const fenceStripped = trimmed
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/```\s*$/i, '')
		.trim();
	try {
		return JSON.parse(fenceStripped);
	} catch (err) {
		throw new Error(
			`judge: could not parse JSON output: ${err instanceof Error ? err.message : String(err)}; got: ${content.slice(0, 200)}`
		);
	}
}

function asScore(value: unknown, criterion: string): JudgeCriterionScore {
	if (!value || typeof value !== 'object') {
		throw new Error(`judge: missing object for criterion ${criterion}`);
	}
	const score = (value as { score?: unknown }).score;
	const rationale = (value as { rationale?: unknown }).rationale;
	if (
		typeof score !== 'number' ||
		!Number.isInteger(score) ||
		score < 1 ||
		score > 5
	) {
		throw new Error(`judge: invalid score for ${criterion}: ${JSON.stringify(score)}`);
	}
	if (typeof rationale !== 'string' || rationale.trim().length === 0) {
		throw new Error(`judge: missing rationale for ${criterion}`);
	}
	return { score: score as JudgeCriterionScore['score'], rationale };
}

function extractAnswerContent(response: unknown): string {
	if (!response || typeof response !== 'object') {
		throw new Error('judge: LLM response is not an object');
	}
	const choices = (response as { choices?: unknown }).choices;
	if (!Array.isArray(choices) || choices.length === 0) {
		throw new Error('judge: LLM response has no choices');
	}
	const message = (choices[0] as { message?: unknown }).message;
	if (!message || typeof message !== 'object') {
		throw new Error('judge: LLM response choice has no message');
	}
	const content = (message as { content?: unknown }).content;
	if (typeof content !== 'string' || content.length === 0) {
		throw new Error('judge: LLM response content is empty');
	}
	return content;
}

export function computeWeightedScore(verdict: Omit<JudgeVerdict, 'weightedScore'>): number {
	return (
		verdict.accuracy.score * WEIGHTS.accuracy +
		verdict.calibration.score * WEIGHTS.calibration +
		verdict.completeness.score * WEIGHTS.completeness +
		verdict.tone.score * WEIGHTS.tone
	);
}

export async function judgeAnswer(input: JudgeInput): Promise<JudgeVerdict> {
	const messages: ChatMessage[] = [
		{ role: 'system', content: SYSTEM_PROMPT },
		{ role: 'user', content: buildUserMessage(input) }
	];
	const response = await llmChatCompletion({
		userId: EVAL_JUDGE_USER_ID,
		messages,
		temperature: 0
	});
	const raw = parseJsonContent(extractAnswerContent(response));
	if (!raw || typeof raw !== 'object') {
		throw new Error(`judge: parsed JSON is not an object`);
	}
	const obj = raw as Record<string, unknown>;
	const accuracy = asScore(obj.accuracy, 'accuracy');
	const calibration = asScore(obj.calibration, 'calibration');
	const completeness = asScore(obj.completeness, 'completeness');
	const tone = asScore(obj.tone, 'tone');
	return {
		accuracy,
		calibration,
		completeness,
		tone,
		weightedScore: computeWeightedScore({ accuracy, calibration, completeness, tone })
	};
}
