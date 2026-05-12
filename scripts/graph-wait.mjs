#!/usr/bin/env node
/**
 * Wait for FalkorDB (Redis) to accept connections with optional auth.
 * Uses REDISCLI_AUTH inside the container (same mechanism as redis-cli -a).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const envPath = join(root, '.env');

const DEFAULT_PW = 'eigen_falkor_dev';

function passwordFromDotEnv() {
	if (!existsSync(envPath)) return null;
	const text = readFileSync(envPath, 'utf8');
	for (const line of text.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const m = /^FALKOR_PASSWORD=(.*)$/.exec(trimmed);
		if (!m) continue;
		let v = m[1].trim();
		if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
			v = v.slice(1, -1);
		}
		return v || null;
	}
	return null;
}

const pw = (process.env.FALKOR_PASSWORD ?? passwordFromDotEnv() ?? DEFAULT_PW).trim() || DEFAULT_PW;

execFileSync(
	'docker',
	['compose', 'exec', '-T', '-e', `REDISCLI_AUTH=${pw}`, 'falkordb', 'redis-cli', 'ping'],
	{
		cwd: root,
		stdio: 'inherit'
	}
);
