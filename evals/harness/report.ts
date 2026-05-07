import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const REPORTS_DIR = resolve(__dirname, '../reports');
export const BASELINES_DIR = resolve(__dirname, '../baselines');

export function timestamp(): string {
	return new Date().toISOString().replace(/[:.]/g, '-');
}

export function writeReport(prefix: string, payload: unknown): { reportPath: string; latestPath: string } {
	mkdirSync(REPORTS_DIR, { recursive: true });
	const reportPath = resolve(REPORTS_DIR, `${prefix}-${timestamp()}.json`);
	const latestPath = resolve(REPORTS_DIR, `${prefix}-latest.json`);
	const json = JSON.stringify(payload, null, 2);
	writeFileSync(reportPath, json);
	writeFileSync(latestPath, json);
	return { reportPath, latestPath };
}

export function copyToBaseline(latestPath: string, name: string): string {
	mkdirSync(BASELINES_DIR, { recursive: true });
	const dest = resolve(BASELINES_DIR, `${name}.json`);
	copyFileSync(latestPath, dest);
	return dest;
}
