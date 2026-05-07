import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client';
import { searchThoughts } from '$lib/server/retrieval/service';

export type RetrievalContextItem = {
	id: string;
	normalizedText: string;
	category: string;
	score: number;
	vectorScore: number;
	graphScore: number;
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
	'You answer questions strictly from the provided thoughts.',
	'Rules:',
	'- Use only facts that appear in the provided thoughts.',
	'- If the thoughts do not contain enough information to answer, say so explicitly and do not guess.',
	'- Cite supporting thoughts inline using [t_id] markers (e.g. "Marcus suggested rice flour [t_006]").',
	'- Keep the answer concise; one short paragraph unless a list is clearly more useful.',
	'- Do not invent thought ids; only cite ids that appear in the provided thoughts list.'
].join('\n');

function formatThoughtsForPrompt(items: RetrievalContextItem[]): string {
	if (items.length === 0) return '(no thoughts retrieved)';
	return items
		.map(
			(t, i) =>
				`#${i + 1} [id=${t.id}] (${t.category}, score=${t.score.toFixed(3)})\n${t.normalizedText}`
		)
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
	const retrieved = await searchThoughts({
		userId: input.userId,
		query: trimmedQuestion,
		topK: input.topK ?? 8,
		weights: input.weights
	});
	const contextItems: RetrievalContextItem[] = retrieved.map((r) => ({
		id: r.id,
		normalizedText: r.normalizedText,
		category: r.category,
		score: r.score,
		vectorScore: r.vectorScore,
		graphScore: r.graphScore
	}));
	const messages: ChatMessage[] = [
		{ role: 'system', content: SYSTEM_PROMPT },
		{
			role: 'user',
			content: `Question: ${trimmedQuestion}\n\nThoughts:\n${formatThoughtsForPrompt(contextItems)}`
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
