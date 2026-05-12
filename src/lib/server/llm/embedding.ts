import { env } from '$env/dynamic/private';
import { compress, type Intensity } from './embedding-compress';
import { llmCreateEmbeddings } from './llm-client';

const EMBEDDING_DIMENSIONS = 1536;

const INTENSITY_VALUES = new Set<Intensity>(['lite', 'full', 'ultra']);

function parseEmbeddingCompressIntensity(): Intensity {
	const raw = env.EMBEDDING_COMPRESS_INTENSITY?.trim();
	if (!raw) {
		throw new Error(
			'EMBEDDING_COMPRESS_INTENSITY is not set (required: lite | full | ultra). Vectors use deterministic compress before embedding.'
		);
	}
	const key = raw.toLowerCase() as Intensity;
	if (!INTENSITY_VALUES.has(key)) {
		throw new Error(
			`EMBEDDING_COMPRESS_INTENSITY must be lite, full, or ultra (got "${raw}")`
		);
	}
	return key;
}

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
	const intensity = parseEmbeddingCompressIntensity();
	const payload = compress(input, { intensity });
	const response = await llmCreateEmbeddings({ userId, input: payload });
	return extractFirstEmbedding(response);
}
