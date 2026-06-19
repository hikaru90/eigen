import { describe, expect, it } from 'vitest';
import {
	parseGtdProjectAuditBatchPayload,
	parseGtdProjectJudgmentPayload,
	shouldInvokeGtdProjectJudge
} from './judge-gtd-project';

describe('judge-gtd-project', () => {
	it('parseGtdProjectJudgmentPayload reads isGtdProject', () => {
		expect(parseGtdProjectJudgmentPayload({ isGtdProject: true, canonicalLabel: 'EigenMesh' }, 'Eigen')).toEqual({
			isGtdProject: true,
			canonicalLabel: 'EigenMesh'
		});
		expect(parseGtdProjectJudgmentPayload({ isGtdProject: false }, 'roasted garlic')).toEqual({
			isGtdProject: false,
			canonicalLabel: 'roasted garlic'
		});
	});

	it('shouldInvokeGtdProjectJudge requires evidence before LLM spend', () => {
		expect(shouldInvokeGtdProjectJudge({ linkedThoughtCount: 1, openLoopCount: 0 })).toBe(false);
		expect(shouldInvokeGtdProjectJudge({ linkedThoughtCount: 2, openLoopCount: 0 })).toBe(false);
		expect(shouldInvokeGtdProjectJudge({ linkedThoughtCount: 3, openLoopCount: 0 })).toBe(true);
		expect(shouldInvokeGtdProjectJudge({ linkedThoughtCount: 2, openLoopCount: 1 })).toBe(true);
		expect(shouldInvokeGtdProjectJudge({ linkedThoughtCount: 0, openLoopCount: 0, force: true })).toBe(
			true
		);
	});

	it('parseGtdProjectAuditBatchPayload validates entity ids', () => {
		const allowed = new Set(['a', 'b']);
		const parsed = parseGtdProjectAuditBatchPayload(
			{
				results: [
					{ entityId: 'a', isGtdProject: false },
					{ entityId: 'b', isGtdProject: true, canonicalLabel: 'EigenMesh' }
				]
			},
			allowed
		);
		expect(parsed).toHaveLength(2);
		expect(parsed[0]?.isGtdProject).toBe(false);
	});
});
