#!/usr/bin/env node
/**
 * Inject chunk IDs into client bundles, then upload source maps to PostHog Error Tracking.
 * Requires a personal API key (phx_…) at build time — not the project key (phc_…).
 * Set POSTHOG_SOURCEMAPS_REQUIRED=1 to fail the build when upload cannot complete.
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

function resolvePostHogCliHost() {
	const explicit = process.env.POSTHOG_CLI_HOST?.trim();
	if (explicit) return explicit.replace(/\/$/, '');
	const publicHost = process.env.PUBLIC_POSTHOG_HOST?.trim().replace(/\/$/, '');
	if (publicHost?.includes('eu.i.posthog.com')) return 'https://eu.posthog.com';
	if (publicHost?.includes('us.i.posthog.com')) return 'https://us.posthog.com';
	if (publicHost?.includes('eu.posthog.com')) return 'https://eu.posthog.com';
	if (publicHost?.includes('posthog.com')) return publicHost.replace('.i.posthog.com', '.posthog.com');
	return 'https://eu.posthog.com';
}

function isPersonalApiKey(key) {
	return key.startsWith('phx_');
}

function isProjectApiKey(key) {
	return key.startsWith('phc_');
}

const required = process.env.POSTHOG_SOURCEMAPS_REQUIRED === '1';

/** Coolify often sets POSTHOG_CLI_API_KEY to the phc_ project key — prefer any phx_ personal key. */
const keyCandidates = [
	['POSTHOG_CLI_API_KEY', process.env.POSTHOG_CLI_API_KEY],
	['POSTHOG_PERSONAL_API_KEY', process.env.POSTHOG_PERSONAL_API_KEY],
	['POSTHOG_API_KEY', process.env.POSTHOG_API_KEY]
]
	.map(([name, value]) => [name, value?.trim()] )
	.filter(([, value]) => Boolean(value));

function fail(message) {
	console.error(`[posthog] ${message}`);
	process.exit(1);
}

function warnAndSkip(message) {
	console.warn(`[posthog] ${message} — skipping (POSTHOG_SOURCEMAPS_REQUIRED is not 1)`);
	process.exit(0);
}

function abortOrSkip(message) {
	if (required) fail(message);
	warnAndSkip(message);
}

function maskKey(key) {
	if (key.length <= 8) return '***';
	return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

const personalKeyEntry = keyCandidates.find(([, value]) => isPersonalApiKey(value));
const projectKeyEntries = keyCandidates.filter(([, value]) => isProjectApiKey(value));

if (!personalKeyEntry) {
	if (projectKeyEntries.length > 0) {
		const names = projectKeyEntries.map(([name]) => name).join(', ');
		abortOrSkip(
			`Only project keys (phc_…) found in ${names}. Source map upload requires a personal API key (phx_…). ` +
				'Create one in PostHog → Settings → Personal API keys and set POSTHOG_PERSONAL_API_KEY as a build-time secret in Coolify.'
		);
	}

	abortOrSkip(
		'No PostHog personal API key at build time (POSTHOG_CLI_API_KEY / POSTHOG_PERSONAL_API_KEY). ' +
			'Add a phx_ key to Coolify build secrets (not runtime-only env).'
	);
}

const [apiKeySource, apiKey] = personalKeyEntry;

const directory = process.env.POSTHOG_SOURCEMAP_DIR?.trim() || 'build/client';
const mapDir = join(repoRoot, directory);
if (!existsSync(mapDir)) {
	abortOrSkip(`Source map directory not found: ${mapDir} (run npm run build first)`);
}

const cliBin = join(repoRoot, 'node_modules', '.bin', 'posthog-cli');
if (!existsSync(cliBin)) {
	abortOrSkip(`posthog-cli not found at ${cliBin}`);
}

const host = resolvePostHogCliHost();
const projectId = process.env.POSTHOG_CLI_PROJECT_ID?.trim() || '208285';
const releaseName = process.env.POSTHOG_RELEASE_NAME?.trim() || 'eigen';
const releaseVersion =
	process.env.SOURCE_VERSION?.trim() ||
	process.env.GITHUB_SHA?.trim() ||
	process.env.SOURCE_COMMIT?.trim() ||
	process.env.COOLIFY_SOURCE_COMMIT?.trim() ||
	gitHead() ||
	'unknown';

const cliEnv = {
	...process.env,
	POSTHOG_CLI_API_KEY: apiKey,
	POSTHOG_CLI_PROJECT_ID: projectId
};

const releaseLabel = `${releaseName}@${releaseVersion.slice(0, 12)}`;

function runCli(subcommand, extraArgs, stepLabel) {
	try {
		execFileSync(
			cliBin,
			['--host', host, 'sourcemap', subcommand, '--directory', mapDir, ...extraArgs],
			{ cwd: repoRoot, env: cliEnv, stdio: 'inherit' }
		);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		if (detail.includes('authentication') || detail.includes('invalid')) {
			fail(
				`${stepLabel} authentication failed. Verify ${apiKeySource} is a valid phx_ personal API key ` +
					`with access to project ${projectId} on ${host}. Coolify must inject this at **build** time, not runtime only. ` +
					`Detail: ${detail}`
			);
		}
		fail(`${stepLabel} failed: ${detail}`);
	}
}

const releaseArgs = ['--release-name', releaseName, '--release-version', releaseVersion];

console.log(
	`[posthog] Injecting chunk IDs in ${directory} (project ${projectId}, release ${releaseLabel}, key ${apiKeySource}=${maskKey(apiKey)})`
);
runCli('inject', releaseArgs, 'Source map inject');

console.log(`[posthog] Uploading source maps from ${directory} to ${host} (release ${releaseLabel})`);
runCli('upload', [...releaseArgs, '--delete-after'], 'Source map upload');

console.log('[posthog] Source map upload complete');
