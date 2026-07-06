import { writeFileSync } from 'node:fs';
import { isEnvValuePresent } from './env-file.mjs';

export const RUNTIME_ENV_PATH = '/tmp/eigen-runtime.env';

const RUNTIME_KEYS = [
	'ADMIN_CONSOLIDATION_KEY',
	'VAPID_PUBLIC_KEY',
	'VAPID_PRIVATE_KEY',
	'VAPID_SUBJECT'
];

/** @param {string} value */
function shellSingleQuote(value) {
	return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

/** Persist bootstrap secrets for the app process (entrypoint sources this file). */
export function writeRuntimeEnvFile(path = RUNTIME_ENV_PATH) {
	/** @type {Record<string, string>} */
	const values = {};
	for (const key of RUNTIME_KEYS) {
		const value = process.env[key]?.trim();
		if (isEnvValuePresent(value)) {
			values[key] = value;
		}
	}

	if (Object.keys(values).length === 0) {
		return false;
	}

	const body = `${Object.entries(values)
		.map(([key, value]) => `${key}=${shellSingleQuote(value)}`)
		.join('\n')}\n`;
	writeFileSync(path, body, 'utf8');
	return true;
}
