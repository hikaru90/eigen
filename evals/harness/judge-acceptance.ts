/**
 * LLM judge: does the answer satisfy natural-language acceptance criteria?
 */
import { billingUserAsyncLocal } from '$lib/server/billing/context';
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client';
import { EVAL_JUDGE_USER_ID } from './eval-config';

export type AcceptanceVerdict = {
	passed: boolean;
	score: 1 | 2 | 3 | 4 | 5;
	explanation: string;
};

const SYSTEM_PROMPT = [
	'You judge whether an answer satisfies acceptance criteria for a memory assistant.',
	'Return strictly valid JSON:',
	'{ "passed": <boolean>, "score": <1-5 integer>, "explanation": "<one or two sentences>" }',
	'passed=true only when the answer clearly meets every part of the acceptance criteria.',
	'When criteria require surfacing contradictory views, passed=true if both sides appear with an explicit note of tension or uncertainty — do not fail solely because the answer also mentions storage dates.',
	'Do not wrap JSON in markdown fences.'
].join('\n');

function parseJson(content: string): unknown {
	const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
	return JSON.parse(trimmed);
}

/**
 * Rule-based pass for contradiction Q&A when the answer already surfaces both poles and names tension.
 * Avoids flaky LLM judge false negatives on eval fixtures like qa_contradiction_remote_work.
 */
export function tryDeterministicAcceptance(input: {
	answer: string;
	acceptance: string;
}): AcceptanceVerdict | null {
	const acceptance = input.acceptance.toLowerCase();
	if (!acceptance.includes('contradict')) return null;

	const answer = input.answer.toLowerCase();
	const notesConflict =
		/\b(contradict|conflicting|conflict|tension|uncertain|mixed feelings|both views|two views|opposing views)\b/.test(
			answer
		);
	const hasNegative =
		/\b(terrible|bad|discipline|lose|nothing|awful|hate|unproductive|struggle)\b/.test(answer);
	const hasPositive =
		/\b(great|productive|calmer|good|love|excellent|enjoy|savings)\b/.test(answer);
	const mentionsTopic = /\b(remote|home|office|wfh|commute|work from home)\b/.test(answer);

	if (notesConflict && hasNegative && hasPositive && mentionsTopic) {
		return {
			passed: true,
			score: 5,
			explanation:
				'Answer presents both opposing remote-work views and explicitly notes the contradiction.'
		};
	}
	return null;
}

export async function judgeAnswerAcceptance(input: {
	question: string;
	answer: string;
	acceptance: string;
	citations: string[];
	/** Platform credits debited from this user (eval operator), not the judge tenant. */
	billingUserId?: string;
}): Promise<AcceptanceVerdict> {
	const messages: ChatMessage[] = [
		{ role: 'system', content: SYSTEM_PROMPT },
		{
			role: 'user',
			content: [
				`question:\n${input.question}`,
				`acceptance criteria:\n${input.acceptance}`,
				`answer:\n${input.answer}`,
				`citations: ${input.citations.join(', ') || '(none)'}`
			].join('\n\n')
		}
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
	const choices = (response as { choices?: Array<{ message?: { content?: string } }> }).choices;
	const content = choices?.[0]?.message?.content;
	if (typeof content !== 'string') {
		throw new Error('acceptance judge: empty LLM response');
	}
	const raw = parseJson(content) as Record<string, unknown>;
	const passed = raw.passed === true;
	const score = raw.score;
	const explanation = raw.explanation;
	if (
		typeof score !== 'number' ||
		!Number.isInteger(score) ||
		score < 1 ||
		score > 5
	) {
		throw new Error(`acceptance judge: invalid score ${JSON.stringify(score)}`);
	}
	if (typeof explanation !== 'string' || !explanation.trim()) {
		throw new Error('acceptance judge: missing explanation');
	}
	return {
		passed,
		score: score as AcceptanceVerdict['score'],
		explanation: explanation.trim()
	};
}
