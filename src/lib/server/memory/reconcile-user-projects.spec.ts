import { describe, expect, it } from 'vitest';
import { buildReconcilePrompt, parseReconcilePayload } from './reconcile-user-projects';

describe('reconcile-user-projects', () => {
	it('buildReconcilePrompt includes graph context and stay-separate policy', () => {
		const prompt = buildReconcilePrompt(
			[
				{
					entityId: 'p1',
					label: 'Kitchen remodel',
					openLoopCount: 2,
					linkedThoughtSummaries: ['Pick tile samples']
				},
				{
					entityId: 'p2',
					label: 'Bathroom remodel',
					openLoopCount: 1,
					linkedThoughtSummaries: ['Call plumber']
				}
			],
			{
				hubCandidates: [
					{
						entityId: 'h1',
						label: 'contractor',
						entityType: 'person',
						mentionCount: 3,
						linkedThoughtSummaries: ['Meet contractor Tuesday']
					}
				],
				graphNeighborPairs: [
					{ sourceLabel: 'Kitchen remodel', targetLabel: 'contractor', predicate: 'uses' }
				]
			}
		);
		expect(prompt).toContain('Kitchen remodel');
		expect(prompt).toContain('Bathroom remodel');
		expect(prompt).toContain('Do NOT merge related but distinct bodies of work');
		expect(prompt).toContain('Kitchen remodel --uses--> contractor');
	});

	it('parseReconcilePayload skips groups without losers', () => {
		const parsed = parseReconcilePayload(
			{
				mergeGroups: [{ winnerEntityId: 'w', loserEntityIds: [], canonicalLabel: 'X' }]
			},
			new Set(['w'])
		);
		expect(parsed.mergeGroups).toHaveLength(0);
	});

	it('parseReconcilePayload ignores grounding demote ids not in allowed set', () => {
		const parsed = parseReconcilePayload({ demoteEntityIds: ['nope'] }, new Set(['a']));
		expect(parsed.demoteEntityIds).toEqual([]);
	});
});
