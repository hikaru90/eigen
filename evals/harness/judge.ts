/**
 * LLM-as-judge for answer-quality evals.
 *
 * Single multi-criteria call per case:
 *   - faithfulness  (1..5): every claim is grounded in the provided thoughts
 *   - relevance     (1..5): answer addresses the question
 *   - usefulness    (1..5): would meaningfully help a user with this question
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
	faithfulness: JudgeCriterionScore;
	relevance: JudgeCriterionScore;
	usefulness: JudgeCriterionScore;
};

export type JudgeInput = {
	question: string;
	answer: string;
	citations: string[];
	thoughts: Array<{ id: string; normalizedText: string }>;
};

const SYSTEM_PROMPT = [
	'You are an expert evaluator judging the quality of grounded RAG answers.',
	'You will be given:',
	'  - a user question',
	'  - the candidate answer',
	'  - the thoughts that were retrieved as context (with stable ids)',
	'  - the ids the answer cites',
	'',
	'Score the answer on three criteria using whole integers 1..5:',
	'  faithfulness  -- every factual claim is supported by the provided thoughts (5 = fully grounded; 1 = mostly hallucinated)',
	'  relevance     -- the answer addresses the asked question (5 = directly on point; 1 = off-topic)',
	'  usefulness    -- the answer is actually helpful to a user with this question (5 = very helpful; 1 = useless)',
	'',
	'Return strictly valid JSON with this exact shape, no prose, no markdown:',
	'{',
	'  "faithfulness": { "score": <1-5 int>, "rationale": "<one sentence>" },',
	'  "relevance":    { "score": <1-5 int>, "rationale": "<one sentence>" },',
	'  "usefulness":   { "score": <1-5 int>, "rationale": "<one sentence>" }',
	'}',
	'Do not include any other keys. Do not wrap the JSON in code fences.'
].join('\n');

function formatThoughts(thoughts: JudgeInput['thoughts']): string {
	if (thoughts.length === 0) return '(none retrieved)';
	return thoughts.map((t) => `[id=${t.id}] ${t.normalizedText}`).join('\n');
}

function buildUserMessage(input: JudgeInput): string {
	const cited = input.citations.length > 0 ? input.citations.join(', ') : '(none)';
	return [
		`Question:\n${input.question}`,
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
	return {
		faithfulness: asScore(obj.faithfulness, 'faithfulness'),
		relevance: asScore(obj.relevance, 'relevance'),
		usefulness: asScore(obj.usefulness, 'usefulness')
	};
}
