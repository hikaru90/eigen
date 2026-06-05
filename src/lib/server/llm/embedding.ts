import { env } from '$env/dynamic/private';
import { compress, type Intensity } from './embedding-compress';
import { llmCreateEmbeddings } from './llm-client';
import {
	getCachedQueryEmbedding,
	setCachedQueryEmbedding
} from '$lib/server/retrieval/embedding-cache';

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

export function extractEmbeddings(body: unknown): number[][] {
	if (!body || typeof body !== 'object') {
		throw new Error('LLM embedding response is not an object');
	}
	const data = (body as { data?: unknown }).data;
	if (!Array.isArray(data) || data.length === 0) {
		throw new Error('LLM embedding response has empty data');
	}
	return data.map((item, index) => {
		if (!item || typeof item !== 'object') {
			throw new Error(`LLM embedding response item ${index} is invalid`);
		}
		return toNumberArray((item as { embedding?: unknown }).embedding);
	});
}

function compressForEmbedding(input: string): string {
	const intensity = parseEmbeddingCompressIntensity();
	return compress(input, { intensity });
}

export async function createThoughtEmbedding(userId: string, input: string): Promise<number[]> {
	const cached = getCachedQueryEmbedding(userId, input);
	if (cached) return cached;

	const payload = compressForEmbedding(input);
	const response = await llmCreateEmbeddings({ userId, input: payload });
	const embedding = extractFirstEmbedding(response);
	setCachedQueryEmbedding(userId, input, embedding);
	return embedding;
}

/** Batch embed multiple texts in one gateway call (one rate-limit slot). */
export async function createThoughtEmbeddings(userId: string, inputs: string[]): Promise<number[][]> {
	if (inputs.length === 0) return [];
	if (inputs.length === 1) {
		return [await createThoughtEmbedding(userId, inputs[0]!)];
	}

	const payloads = inputs.map((text) => compressForEmbedding(text));
	const response = await llmCreateEmbeddings({ userId, input: payloads });
	const embeddings = extractEmbeddings(response);
	if (embeddings.length !== inputs.length) {
		throw new Error(
			`LLM embedding batch size mismatch: expected ${inputs.length}, got ${embeddings.length}`
		);
	}
	for (let i = 0; i < inputs.length; i++) {
		setCachedQueryEmbedding(userId, inputs[i]!, embeddings[i]!);
	}
	return embeddings;
}
