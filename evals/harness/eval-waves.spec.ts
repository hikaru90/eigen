import { describe, expect, it } from 'vitest';
import type { EvalEntry } from '$lib/server/db/brain.schema';
import { collectNextWave } from './eval-waves';

function entry(id: string, parallelWave?: string): EvalEntry {
	return {
		id,
		runId: 'run-1',
		ordinal: 0,
		kind: 'check',
		fixtureRef: id,
		inputJson: parallelWave ? { parallelWave } : {},
		expectedJson: {},
		status: 'pending',
		passed: null,
		resultJson: null,
		error: null,
		durationMs: null,
		dependsOnEntryId: null,
		startedAt: null,
		finishedAt: null
	};
}

describe('collectNextWave', () => {
	it('returns a single entry when parallelWave is absent', () => {
		const pending = [entry('a'), entry('b', 'check')];
		expect(collectNextWave(pending).map((e) => e.id)).toEqual(['a']);
	});

	it('groups consecutive entries with the same parallelWave', () => {
		const pending = [
			entry('a', 'check'),
			entry('b', 'check'),
			entry('c', 'answer')
		];
		expect(collectNextWave(pending).map((e) => e.id)).toEqual(['a', 'b']);
	});

	it('stops at the first entry with a different wave id', () => {
		const pending = [
			entry('a', 'check'),
			entry('b', 'retrieval'),
			entry('c', 'check')
		];
		expect(collectNextWave(pending).map((e) => e.id)).toEqual(['a']);
	});
});
