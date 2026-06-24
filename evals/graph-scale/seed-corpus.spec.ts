import { describe, expect, it } from 'vitest';
import { loadCorpus } from '../harness/dataset';
import { buildCorpusTexts, graphScaleCorpusUserId } from './seed-corpus';

describe('seed-corpus helpers', () => {
	it('graphScaleCorpusUserId encodes run and size', () => {
		expect(graphScaleCorpusUserId('run-1', 100)).toBe('graph-scale-corpus-run-1-100');
	});

	it('buildCorpusTexts adds salt when count exceeds fixture corpus length', () => {
		const corpus = loadCorpus();
		const texts = buildCorpusTexts(corpus.thoughts.length + 1, 'abc');
		expect(texts[0]).not.toContain('[graph-scale-');
		expect(texts[corpus.thoughts.length]).toContain('[graph-scale-abc-');
	});

	it('rejects non-positive count', () => {
		expect(() => buildCorpusTexts(0, 'x')).toThrow(/positive integer/);
	});
});
