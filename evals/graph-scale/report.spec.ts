import { describe, expect, it } from 'vitest';
import { graphScaleReportToCsv } from './report';
import type { GraphScaleReport } from './types';

describe('graphScaleReportToCsv', () => {
	it('writes one row per benchmark point', () => {
		const report: GraphScaleReport = {
			runId: 'run-1',
			startedAt: '2026-06-24T00:00:00.000Z',
			finishedAt: '2026-06-24T01:00:00.000Z',
			operatorUserId: 'graph-scale-runner',
			sizes: [50, 100],
			tracks: ['capture', 'qa'],
			points: [
				{
					nThoughts: 50,
					graph: { thoughts: 50, entities: 30, edges: 80, communities: 5, projects: 1 },
					seedWallMs: 120000,
					captureProbe: {
						usd: '0.004800',
						credits: 4.8,
						wallMs: 11000,
						phases: { enrich_entities: 7000 },
						groupId: 'g1'
					},
					qaFixedSet: {
						usdTotal: '0.031000',
						creditsTotal: 31,
						usdPerQuery: '0.006200',
						creditsPerQuery: 6.2,
						p95Ms: 4200,
						queryCount: 5,
						perQuery: [],
						groupId: 'g2'
					},
					consolidation: null
				}
			]
		};

		const csv = graphScaleReportToCsv(report);
		const lines = csv.trim().split('\n');
		expect(lines.length).toBe(2);
		expect(lines[0]).toContain('n_thoughts');
		expect(lines[1]).toContain('50');
		expect(lines[1]).toContain('0.004800');
		expect(lines[1]).toContain('0.031000');
	});
});
