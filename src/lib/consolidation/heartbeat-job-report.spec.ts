import { describe, expect, it } from 'vitest';
import { buildHeartbeatJobReport } from './heartbeat-job-report';

describe('buildHeartbeatJobReport', () => {
	it('explains salience decay and open-task boosts with samples', () => {
		const report = buildHeartbeatJobReport('salience_compute', {
			decayed: 62,
			openTasks: 29,
			samples: [
				{ kind: 'thought', id: 't1', label: 'old trip notes', note: 'faded' },
				{ kind: 'thought', id: 't2', label: 'call dentist', note: 'open task boosted' }
			],
			sampleTotal: 91
		});
		expect(report.summary).toBe('62 memories faded, 29 open tasks boosted');
		expect(report.verdictLabel).toMatch(/Normal/);
		expect(report.samples).toHaveLength(2);
		expect(report.sampleNote).toBe('Showing 2 of 91');
	});

	it('lists deleted ontology keys as the change log', () => {
		const report = buildHeartbeatJobReport('ontology_prune', {
			deletedEntityKindIds: ['k1'],
			deletedRelationKindIds: [],
			deletedKeys: ['old_custom_tag']
		});
		expect(report.summary).toBe('1 unused label removed');
		expect(report.samples?.[0]).toMatchObject({
			label: 'old_custom_tag',
			note: 'deleted unused label'
		});
		expect(report.verdictLabel).toMatch(/Good cleanup/);
	});

	it('treats zero ontology prune as healthy', () => {
		const report = buildHeartbeatJobReport('ontology_prune', {
			deletedEntityKindIds: [],
			deletedRelationKindIds: [],
			deletedKeys: []
		});
		expect(report.summary).toBe('no unused labels removed');
		expect(report.verdictLabel).toMatch(/Good/);
	});

	it('explains sparse community graph as diagnostic not failure', () => {
		const report = buildHeartbeatJobReport('community_detection', {
			totalCommunities: 383,
			changed: true,
			graphHealth: {
				lowConfidence: true,
				reasons: ['low relation density (0.0100)', 'many disconnected components (101)']
			},
			samples: [
				{ kind: 'note', label: 'low relation density (0.0100)', note: 'graph health signal' },
				{ kind: 'note', label: 'Work · family', note: '12 entities' }
			],
			sampleTotal: 2
		});
		expect(report.summary).toContain('383 communities');
		expect(report.summary).toContain('low-confidence graph');
		expect(report.verdict).toBe('info');
		expect(report.verdictLabel).toMatch(/Not a failure/);
		expect(report.samples?.length).toBeGreaterThan(0);
	});

	it('lists newly summarized community titles', () => {
		const report = buildHeartbeatJobReport('community_summaries', {
			total: 50,
			summarized: 50,
			generated: 50,
			pending: 0,
			deferred: 0,
			failed: false,
			samples: [
				{
					kind: 'note',
					id: 'c1',
					label: 'Family planning threads',
					note: 'summarized · e.g. Alex, Berlin'
				}
			],
			sampleTotal: 50
		});
		expect(report.summary).toContain('50 of 50');
		expect(report.verdictLabel).toMatch(/Good/);
		expect(report.samples?.[0]?.label).toBe('Family planning threads');
	});

	it('explains dedup with no candidates as healthy', () => {
		const report = buildHeartbeatJobReport('dedup_canonical_entities', {
			scanned: 200,
			candidates: 0,
			merged: 0,
			samples: [],
			sampleTotal: 0
		});
		expect(report.summary).toBe('no near-duplicates (200 scanned)');
		expect(report.verdictLabel).toMatch(/Good/);
	});

	it('falls back to detail string for legacy jobs', () => {
		const report = buildHeartbeatJobReport('salience_compute', null, {
			ok: true,
			detail: '62 decayed, 29 open tasks raised'
		});
		expect(report.summary).toBe('62 decayed, 29 open tasks raised');
		expect(report.explanation).toMatch(/Unused memories|fade/i);
	});
});
