import { loadCorpus } from '../harness/dataset';

/** Build N capture texts by cycling eval fixture corpus with a stable salt per index. */
export function buildCorpusTexts(count: number, runId: string): string[] {
	if (!Number.isInteger(count) || count < 1) {
		throw new Error(`buildCorpusTexts: count must be a positive integer, got ${count}`);
	}
	const corpus = loadCorpus();
	if (corpus.thoughts.length === 0) {
		throw new Error('buildCorpusTexts: eval corpus.yaml has no thoughts');
	}

	const texts: string[] = [];
	for (let i = 0; i < count; i++) {
		const fixture = corpus.thoughts[i % corpus.thoughts.length];
		const salt = i >= corpus.thoughts.length ? ` [graph-scale-${runId}-${i}]` : '';
		texts.push(`${fixture.rawText}${salt}`);
	}
	return texts;
}

export function graphScaleCorpusUserId(runId: string, n: number): string {
	return `graph-scale-corpus-${runId}-${n}`;
}
