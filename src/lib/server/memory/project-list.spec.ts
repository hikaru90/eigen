import { describe, expect, it } from 'vitest';
import { parseProjectsPayload } from '$lib/server/grounding/seed-projects';
import { parseGtdProjectJudgmentPayload } from '$lib/server/memory/judge-gtd-project';
import { parseProjectIdentityPayload } from '$lib/server/memory/resolve-project-identity';
import { parseReconcilePayload } from '$lib/server/memory/reconcile-user-projects';

describe('parseGtdProjectJudgmentPayload', () => {
	it('rejects non-project hubs by default parse shape', () => {
		expect(parseGtdProjectJudgmentPayload({ isGtdProject: false }, 'sumac')).toEqual({
			isGtdProject: false,
			canonicalLabel: 'sumac'
		});
	});
});

describe('parseProjectIdentityPayload', () => {
	it('accepts canonical entity id from allowed set', () => {
		const allowed = new Set(['a', 'b']);
		const parsed = parseProjectIdentityPayload(
			{
				canonicalEntityId: 'a',
				canonicalLabel: 'EigenMesh',
				mergeEntityIds: ['b']
			},
			allowed
		);
		expect(parsed.canonicalEntityId).toBe('a');
		expect(parsed.mergeEntityIds).toEqual(['b']);
	});
});

describe('parseReconcilePayload', () => {
	it('parses merge groups and demote ids', () => {
		const allowed = new Set(['w', 'l1', 'd1']);
		const parsed = parseReconcilePayload(
			{
				mergeGroups: [{ winnerEntityId: 'w', loserEntityIds: ['l1'], canonicalLabel: 'EigenMesh' }],
				demoteEntityIds: ['d1']
			},
			allowed
		);
		expect(parsed.mergeGroups).toHaveLength(1);
		expect(parsed.demoteEntityIds).toEqual(['d1']);
	});
});

describe('parseProjectsPayload', () => {
	it('normalizes project rows', () => {
		expect(
			parseProjectsPayload({
				projects: [{ name: 'Eigen Mesh', nextActionText: 'Ship header', status: 'active' }]
			})
		).toEqual([{ name: 'Eigen Mesh', nextActionText: 'Ship header', status: 'active' }]);
	});
});
