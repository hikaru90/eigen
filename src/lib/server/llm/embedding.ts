import { llmCreateEmbeddings } from './llm-client';

const EMBEDDING_DIMENSIONS = 1536;

function toNumberArray(value: unknown): number[] {
	if (!Array.isArray(value)) {
		throw new Error('LLM embedding response is missing an embedding array');
	}
	const embedding = value.map((n) => {
		if (typeof n !== 'number' || Number.isNaN(n)) {
			throw new Error('LLM embedding response contains non-numeric values');
		}
		return n;
	});
	if (embedding.length !== EMBEDDING_DIMENSIONS) {
		throw new Error(
			`LLM embedding has unexpected dimensions: ${embedding.length}. Expected ${EMBEDDING_DIMENSIONS}.`
		);
	}
	return embedding;
}

export function extractFirstEmbedding(body: unknown): number[] {
	if (!body || typeof body !== 'object') {
		throw new Error('LLM embedding response is not an object');
	}
	const data = (body as { data?: unknown }).data;
	if (!Array.isArray(data) || data.length === 0) {
		throw new Error('LLM embedding response has empty data');
	}
	const first = data[0];
	if (!first || typeof first !== 'object') {
		throw new Error('LLM embedding response first item is invalid');
	}
	return toNumberArray((first as { embedding?: unknown }).embedding);
}

export async function createThoughtEmbedding(userId: string, input: string): Promise<number[]> {
	const response = await llmCreateEmbeddings({ userId, input });
	return extractFirstEmbedding(response);
}
