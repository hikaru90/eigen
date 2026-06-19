import { describe, expect, it } from 'vitest';
import { parseReconcilePayload } from './reconcile-user-projects';

describe('reconcile-user-projects', () => {
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
