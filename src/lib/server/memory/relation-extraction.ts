import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client';
import { searchThoughts } from '$lib/server/retrieval/service';

const ALLOWED_RELATION_TYPES = new Set([
	'mentions',
	'depends_on',
	'refines',
	'contradicts',
	'related_to'
]);

export type ExtractedRelation = {
	targetId: string;
	relationType: 'mentions' | 'depends_on' | 'refines' | 'contradicts' | 'related_to';
};

function extractChatContent(response: unknown): string {
	if (!response || typeof response !== 'object') {
		throw new Error('Relation extraction response is not an object');
	}
	const choices = (response as { choices?: unknown }).choices;
	if (!Array.isArray(choices) || choices.length === 0) {
		throw new Error('Relation extraction response has no choices');
	}
	const message = (choices[0] as { message?: unknown }).message;
	if (!message || typeof message !== 'object') {
		throw new Error('Relation extraction response has no message');
	}
	const content = (message as { content?: unknown }).content;
	if (typeof content !== 'string') {
		throw new Error('Relation extraction message content must be a string');
	}
	return content;
}

function parseRelations(content: string): ExtractedRelation[] {
	const parsed = JSON.parse(content) as unknown;
	if (!Array.isArray(parsed)) {
		throw new Error('Relation extraction output must be a JSON array');
	}

	return parsed
		.map((entry) => {
			if (!entry || typeof entry !== 'object') return null;
			const targetId = typeof (entry as { targetId?: unknown }).targetId === 'string' ? (entry as { targetId: string }).targetId.trim() : '';
			const relationType =
				typeof (entry as { relationType?: unknown }).relationType === 'string'
					? (entry as { relationType: string }).relationType
					: '';
			if (!targetId || !ALLOWED_RELATION_TYPES.has(relationType)) return null;
			return {
				targetId,
				relationType: relationType as ExtractedRelation['relationType']
			};
		})
		.filter((value): value is ExtractedRelation => value !== null);
}

export async function extractRelations(input: {
	userId: string;
	thoughtId: string;
	normalizedText: string;
}): Promise<ExtractedRelation[]> {
	const neighbors = await searchThoughts({
		userId: input.userId,
		query: input.normalizedText,
		topK: 8
	});
	const candidateNeighbors = neighbors.filter((neighbor) => neighbor.id !== input.thoughtId);
	if (candidateNeighbors.length === 0) return [];

	const prompt = [
		'Return ONLY JSON.',
		'Given a source thought and candidate thought ids, return a JSON array of relations from source to candidates.',
		'Allowed relation types: mentions, depends_on, refines, contradicts, related_to.',
		'Use this schema exactly: [{"targetId":"<candidate-id>","relationType":"related_to"}].',
		'Return an empty array if no relation is justified.',
		`Source thought (${input.thoughtId}): ${input.normalizedText}`,
		'Candidates:',
		...candidateNeighbors.map((neighbor) => `${neighbor.id}: ${neighbor.normalizedText}`)
	].join('\n');

	const messages: ChatMessage[] = [
		{ role: 'system', content: 'You extract explicit thought-to-thought relations.' },
		{ role: 'user', content: prompt }
	];

	const response = await llmChatCompletion({
		userId: input.userId,
		messages,
		temperature: 0
	});

	return parseRelations(extractChatContent(response));
}
