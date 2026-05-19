/**
 * LLM judge: does the answer satisfy natural-language acceptance criteria?
 */
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
	'When criteria require connecting multiple notes, passed=true if the answer combines them into one clear conclusion (e.g. A clashes with B because C), even if Evidence lists facts separately.',
	'passed=true for scheduling-conflict criteria when the Answer (or opening summary) states the clash between relocation and a mandatory event, even if Unknown lists minor gaps like exact dates.',
	'Do not fail solely because Unknown mentions details absent from memory, unless Unknown contradicts or walks back the required conclusion.',
	'Do not wrap JSON in markdown fences.'
].join('\n');

function parseJson(content: string): unknown {
	const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
	return JSON.parse(trimmed);
}

export async function judgeAnswerAcceptance(input: {
	question: string;
	answer: string;
	acceptance: string;
	citations: string[];
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
	const response = await llmChatCompletion({
		userId: EVAL_JUDGE_USER_ID,
		messages,
		temperature: 0
	});
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
