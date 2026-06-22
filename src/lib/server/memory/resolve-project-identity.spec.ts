import { describe, expect, it } from 'vitest';
import {
	buildIdentityPrompt,
	effectiveMergeEntityIds,
	mergeEntityIdsAllowedForMode,
	type ProjectIdentityContext
} from './resolve-project-identity';

const emptyContext: ProjectIdentityContext = {
	gtdProjects: [],
	hubCandidates: [],
	graphNeighborPairs: []
};

describe('resolve-project-identity merge policy', () => {
	it('mergeEntityIdsAllowedForMode allows merge only for seed and reconcile', () => {
		expect(mergeEntityIdsAllowedForMode('seed')).toBe(true);
		expect(mergeEntityIdsAllowedForMode('reconcile')).toBe(true);
		expect(mergeEntityIdsAllowedForMode('promote')).toBe(false);
		expect(mergeEntityIdsAllowedForMode('assign')).toBe(false);
	});

	it('effectiveMergeEntityIds strips ids for promote and assign', () => {
		expect(effectiveMergeEntityIds('promote', ['a', 'b'])).toEqual([]);
		expect(effectiveMergeEntityIds('assign', ['a'])).toEqual([]);
		expect(effectiveMergeEntityIds('seed', ['a', 'b'])).toEqual(['a', 'b']);
	});

	it('buildIdentityPrompt omits mergeEntityIds schema for promote mode', () => {
		const prompt = buildIdentityPrompt({
			surfaceLabel: 'Kitchen remodel',
			mode: 'promote',
			context: emptyContext
		});
		expect(prompt).not.toContain('mergeEntityIds');
		expect(prompt).toContain('remain separate projects');
	});

	it('buildIdentityPrompt includes mergeEntityIds schema for seed mode', () => {
		const prompt = buildIdentityPrompt({
			surfaceLabel: 'EigenMesh',
			mode: 'seed',
			context: emptyContext
		});
		expect(prompt).toContain('mergeEntityIds');
		expect(prompt).toContain('SAME multi-step initiative');
	});
});
