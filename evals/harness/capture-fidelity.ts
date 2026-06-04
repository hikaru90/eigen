/**
 * LLM-as-judge for capture fidelity.
 *
 * Checks whether the stored `normalizedText` and assigned `category` faithfully
 * represent the original `rawText` submitted by an agent. Used exclusively in
 * the agent ingest eval — it is NOT part of the production capture pipeline.
 *
 * Scoring (1..5):
 *   5 — perfect: all key facts preserved, category appropriate
 *   4 — good: minor wording change but nothing important lost
 *   3 — acceptable: some details compressed but core intent intact
 *   2 — degraded: a key fact lost or subtly distorted
 *   1 — failed: key information missing or category clearly wrong
 *
 * faithful = score >= 4.
 *
 * Judge spend is logged under EVAL_JUDGE_USER_ID, not the ephemeral eval run
 * user, so costs are queryable via the stable judge identity.
 */
import { billingUserAsyncLocal } from '$lib/server/billing/context';
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client';
import { EVAL_JUDGE_USER_ID } from './eval-config';

export type FidelityVerdict = {
	faithful: boolean;
	score: 1 | 2 | 3 | 4 | 5;
	rationale: string;
};

const SYSTEM_PROMPT = [
	'You are an expert evaluator judging the quality of a memory capture pipeline.',
	'You will be given:',
	'  - rawText: the original unprocessed input submitted by an agent',
	'  - normalizedText: the stored normalized form after pipeline processing',
	'  - category: the category the pipeline assigned to this thought',
	'',
	'Rate the capture fidelity on a scale of 1..5:',
	'  5 — perfect: all key facts from rawText are present in normalizedText; category is appropriate',
	'  4 — good: minor wording change only, no important detail lost; category is appropriate',
	'  3 — acceptable: some compression but the core intent and key facts are intact; category reasonable',
	'  2 — degraded: at least one key fact is missing or subtly distorted; OR category is questionable',
	'  1 — failed: key information is clearly missing or misrepresented; OR category is clearly wrong',
	'',
	'Return strictly valid JSON with this exact shape, no prose, no markdown:',
	'{',
	'  "score": <1-5 integer>,',
	'  "rationale": "<one sentence explaining the score>"',
	'}',
	'Do not include any other keys. Do not wrap the JSON in code fences.'
].join('\n');

function buildUserMessage(input: {
	rawText: string;
	normalizedText: string;
	category: string;
}): string {
	return [
		`rawText:\n${input.rawText}`,
		`normalizedText:\n${input.normalizedText}`,
		`category: ${input.category}`
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
			`capture-fidelity judge: could not parse JSON output: ${
				err instanceof Error ? err.message : String(err)
			}; got: ${content.slice(0, 200)}`
		);
	}
}

function extractContent(response: unknown): string {
	if (!response || typeof response !== 'object') {
		throw new Error('capture-fidelity judge: LLM response is not an object');
	}
	const choices = (response as { choices?: unknown }).choices;
	if (!Array.isArray(choices) || choices.length === 0) {
		throw new Error('capture-fidelity judge: LLM response has no choices');
	}
	const message = (choices[0] as { message?: unknown }).message;
	if (!message || typeof message !== 'object') {
		throw new Error('capture-fidelity judge: LLM response choice has no message');
	}
	const content = (message as { content?: unknown }).content;
	if (typeof content !== 'string' || content.length === 0) {
		throw new Error('capture-fidelity judge: LLM response content is empty');
	}
	return content;
}

export async function judgeCaptureFidelity(input: {
	rawText: string;
	normalizedText: string;
	category: string;
	/** Platform credits debited from this user (eval operator), not the judge tenant. */
	billingUserId?: string;
}): Promise<FidelityVerdict> {
	const messages: ChatMessage[] = [
		{ role: 'system', content: SYSTEM_PROMPT },
		{ role: 'user', content: buildUserMessage(input) }
	];
	const callLlm = () =>
		llmChatCompletion({
			userId: EVAL_JUDGE_USER_ID,
			messages,
			temperature: 0
		});
	const billingUserId = input.billingUserId?.trim();
	const response = billingUserId
		? await billingUserAsyncLocal.run(billingUserId, callLlm)
		: await callLlm();
	const raw = parseJsonContent(extractContent(response));
	if (!raw || typeof raw !== 'object') {
		throw new Error('capture-fidelity judge: parsed JSON is not an object');
	}
	const obj = raw as Record<string, unknown>;
	const score = obj.score;
	const rationale = obj.rationale;
	if (
		typeof score !== 'number' ||
		!Number.isInteger(score) ||
		score < 1 ||
		score > 5
	) {
		throw new Error(
			`capture-fidelity judge: invalid score value: ${JSON.stringify(score)}`
		);
	}
	if (typeof rationale !== 'string' || rationale.trim().length === 0) {
		throw new Error('capture-fidelity judge: missing rationale');
	}
	const validScore = score as FidelityVerdict['score'];
	return {
		faithful: validScore >= 4,
		score: validScore,
		rationale
	};
}
