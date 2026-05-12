import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client';
import { searchThoughts } from '$lib/server/retrieval/service';
import { CONTEXT_WEIGHTS } from '$lib/server/retrieval';
import { tryRecordRetrievalQualityEvent } from '$lib/server/retrieval/quality-telemetry';

export type RetrievalContextItem = {
	id: string;
	normalizedText: string;
	category: string;
	score: number;
	vectorScore: number;
	graphScore: number;
	/** Optional Falkor/entity path hint from hybrid retrieval. */
	graphProvenance?: string;
};

export type ComposedAnswer = {
	answer: string;
	citations: string[];
	retrieved: RetrievalContextItem[];
};

export type ComposeAnswerInput = {
	userId: string;
	question: string;
	topK?: number;
	weights?: { vector: number; graph: number };
};

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
	'- Keep the response compact. No preamble, no closing remarks, no meta commentary about the thoughts.'
].join('\n');

function formatThoughtsForPrompt(items: RetrievalContextItem[]): string {
	if (items.length === 0) return '(no thoughts retrieved)';
	return items
		.map((t, i) => {
			const graphLine = t.graphProvenance ? `\nGraph: ${t.graphProvenance}` : '';
			return `#${i + 1} [id=${t.id}] (${t.category}, score=${t.score.toFixed(3)})${graphLine}\n${t.normalizedText}`;
		})
		.join('\n\n');
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

/**
 * Compose a grounded answer to `question` from the user's stored thoughts.
 *
 * Retrieves with `searchThoughts` and asks the configured chat model to answer
 * using only the retrieved thoughts, citing them inline by id. Inherits the
 * 3-retry no-fallback semantics from `llmChatCompletion`.
 */
export async function composeAnswer(input: ComposeAnswerInput): Promise<ComposedAnswer> {
	const trimmedQuestion = input.question.trim();
	if (trimmedQuestion.length === 0) {
		throw new Error('composeAnswer: question must be non-empty');
	}
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
		graphProvenance:
			typeof r.metadata?.graphProvenance === 'string' ? r.metadata.graphProvenance : undefined
	}));
	const messages: ChatMessage[] = [
		{ role: 'system', content: SYSTEM_PROMPT },
		{
			role: 'user',
			content:
				`Question: ${trimmedQuestion}\n\n` +
				`Thoughts:\n${formatThoughtsForPrompt(contextItems)}\n\n` +
				`Respond using the strict format from the system message. Cite ids exactly as written after "id=" above.`
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
	return { answer, citations, retrieved: contextItems };
}
