import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GraphScaleProgressWriter, resolveGraphScaleReportPaths } from './progress-report';

describe('resolveGraphScaleReportPaths', () => {
	it('derives jsonl progress, json summary, and csv from output path', () => {
		const paths = resolveGraphScaleReportPaths('evals/graph-scale/runs/my-run.json');
		expect(paths.progressPath).toContain('my-run.jsonl');
		expect(paths.jsonPath).toContain('my-run.json');
		expect(paths.csvPath).toContain('my-run.csv');
	});
});

describe('GraphScaleProgressWriter', () => {
	it('creates an empty file then appends one JSON line per step', () => {
		const dir = mkdtempSync(join(tmpdir(), 'graph-scale-progress-'));
		const writer = new GraphScaleProgressWriter(join(dir, 'run.jsonl'));

		writer.step({
			step: 'run_started',
			runId: 'run-1',
			operatorUserId: 'graph-scale-runner',
			sizes: [50],
			tracks: ['qa'],
			corpusSource: '/tmp/single-thought-corpus.yaml',
			progressPath: writer.path,
			jsonPath: join(dir, 'run.json'),
			csvPath: join(dir, 'run.csv')
		});
		writer.tick({ pct: 12, etaSec: 600, label: 'N=50 seed enrich' });

		const lines = readFileSync(writer.path, 'utf8').trim().split('\n');
		expect(lines).toHaveLength(2);
		expect(JSON.parse(lines[0]).step).toBe('run_started');
		expect(JSON.parse(lines[1]).step).toBe('progress');
		expect(JSON.parse(lines[1]).pct).toBe(12);
	});
});
