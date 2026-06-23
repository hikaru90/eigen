#!/usr/bin/env node
/**
 * Upload Vite/SvelteKit client source maps to PostHog Error Tracking.
 * Skips when POSTHOG_CLI_API_KEY is unset (local builds).
 * Set POSTHOG_SOURCEMAPS_REQUIRED=1 to fail instead of skip (production deploy).
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function gitHead() {
	try {
		return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: repoRoot }).trim();
	} catch {
		return null;
	}
}

const apiKey =
	process.env.POSTHOG_CLI_API_KEY?.trim() || process.env.POSTHOG_PERSONAL_API_KEY?.trim();
const required = process.env.POSTHOG_SOURCEMAPS_REQUIRED === '1';

if (!apiKey) {
	const message = '[posthog] POSTHOG_CLI_API_KEY not set — skipping source map upload';
	if (required) {
		console.error(`${message} (POSTHOG_SOURCEMAPS_REQUIRED=1)`);
		process.exit(1);
	}
	console.log(message);
	process.exit(0);
}

const directory = process.env.POSTHOG_SOURCEMAP_DIR?.trim() || 'build/client';
const mapDir = join(repoRoot, directory);
if (!existsSync(mapDir)) {
	console.error(`[posthog] Source map directory not found: ${mapDir}`);
	process.exit(1);
}

const host = process.env.POSTHOG_CLI_HOST?.trim() || 'https://eu.posthog.com';
const projectId = process.env.POSTHOG_CLI_PROJECT_ID?.trim() || '208285';
const releaseName = process.env.POSTHOG_RELEASE_NAME?.trim() || 'eigen';
const releaseVersion =
	process.env.SOURCE_VERSION?.trim() ||
	process.env.GITHUB_SHA?.trim() ||
	process.env.SOURCE_COMMIT?.trim() ||
	process.env.COOLIFY_SOURCE_COMMIT?.trim() ||
	gitHead() ||
	'unknown';

const cliBin = join(repoRoot, 'node_modules', '.bin', 'posthog-cli');

const args = [
	'--host',
	host,
	'sourcemap',
	'upload',
	'--directory',
	mapDir,
	'--release-name',
	releaseName,
	'--release-version',
	releaseVersion,
	'--delete-after'
];

console.log(
	`[posthog] Uploading source maps from ${directory} (release ${releaseName}@${releaseVersion.slice(0, 12)})`
);

execFileSync(cliBin, args, {
	cwd: repoRoot,
	env: {
		...process.env,
		POSTHOG_CLI_API_KEY: apiKey,
		POSTHOG_CLI_PROJECT_ID: projectId
	},
	stdio: 'inherit'
});

console.log('[posthog] Source map upload complete');
