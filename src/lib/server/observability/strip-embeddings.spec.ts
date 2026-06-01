import { describe, expect, it } from 'vitest';
import {
	isEmbeddingVectorArray,
	sanitizeChatMessageContent,
	sanitizeMcpToolResult,
	stripEmbeddingsFromValue
} from './strip-embeddings';

const vec = () => Array.from({ length: 1536 }, (_, i) => i / 10_000);

describe('stripEmbeddingsFromValue', () => {
	it('removes embedding fields and 1536-dim numeric arrays', () => {
		const out = stripEmbeddingsFromValue({
			id: 't1',
			embedding: vec(),
			thought: { summaryEmbedding: vec(), label: 'ok' },
			scores: [0.1, 0.2]
		}) as Record<string, unknown>;
		expect(out).toEqual({
			id: 't1',
			thought: { label: 'ok' },
			scores: [0.1, 0.2]
		});
	});

	it('drops top-level embedding arrays', () => {
		expect(stripEmbeddingsFromValue(vec())).toBeUndefined();
	});

	it('preserves short numeric arrays that are not embedding-sized', () => {
		expect(stripEmbeddingsFromValue([1, 2, 3])).toEqual([1, 2, 3]);
	});

	it('isEmbeddingVectorArray validates shape', () => {
		expect(isEmbeddingVectorArray(vec())).toBe(true);
		expect(isEmbeddingVectorArray([1, 2])).toBe(false);
	});
});

describe('sanitizeMcpToolResult', () => {
	it('sanitizes nested list_thoughts payloads', () => {
		const out = sanitizeMcpToolResult({
			thoughts: [{ id: 't1', normalizedText: 'hi', embedding: vec() }]
		}) as { thoughts: Array<Record<string, unknown>> };
		expect(out.thoughts[0]).toEqual({ id: 't1', normalizedText: 'hi' });
	});
});

describe('sanitizeChatMessageContent', () => {
	it('strips embeddings from agent tool-result envelopes', () => {
		const content = `Tool result for list_thoughts:\n${JSON.stringify(
			{ thoughts: [{ id: 't1', embedding: vec() }] },
			null,
			2
		)}\n\nIf more tools are needed, call one now.`;
		const sanitized = sanitizeChatMessageContent(content);
		expect(sanitized).not.toContain('"embedding"');
		expect(sanitized).toContain('t1');
	});
});
