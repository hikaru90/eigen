import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { GraphScaleProgressEvent } from './types';
import type { GraphScaleProgressSnapshot } from './console-progress';

export function resolveGraphScaleReportPaths(outputPath: string): {
	progressPath: string;
	jsonPath: string;
	csvPath: string;
} {
	const abs = resolve(outputPath);
	const jsonPath = abs.endsWith('.json') ? abs : `${abs}.json`;
	const base = jsonPath.replace(/\.json$/i, '');
	return {
		progressPath: `${base}.jsonl`,
		jsonPath,
		csvPath: `${base}.csv`
	};
}

/** Append-only JSONL progress log — one line per benchmark step. */
export class GraphScaleProgressWriter {
	private readonly progressPath: string;

	constructor(progressPath: string) {
		this.progressPath = resolve(progressPath);
		mkdirSync(dirname(this.progressPath), { recursive: true });
		writeFileSync(this.progressPath, '', 'utf8');
	}

	get path(): string {
		return this.progressPath;
	}

	step(event: GraphScaleProgressEvent): void {
		const line = JSON.stringify({ at: new Date().toISOString(), ...event });
		appendFileSync(this.progressPath, `${line}\n`, 'utf8');
	}

	tick(snapshot: GraphScaleProgressSnapshot): void {
		this.step({
			step: 'progress',
			pct: snapshot.pct,
			etaSec: snapshot.etaSec,
			label: snapshot.label
		});
	}
}
