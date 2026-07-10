/**
 * Third-party credentials operators must supply after install — never ship in .env.example
 * or bake into open-source defaults.
 */
export const OSS_OPERATOR_SECRET_KEYS = [
	'SERVICE_API_KEY_EUROUTER',
	'SERVICE_API_KEY_OPENROUTER',
	'LLM_API_KEY',
	'OPENROUTER_API_KEY',
	'PAYPAL_CLIENT_ID',
	'PAYPAL_CLIENT_SECRET',
	'PAYPAL_SECRET',
	'POSTHOG_API_KEY',
	'POSTHOG_CLI_API_KEY',
	'POSTHOG_PERSONAL_API_KEY',
	'PUBLIC_POSTHOG_KEY',
	'GOOGLE_CLIENT_ID',
	'GOOGLE_CLIENT_SECRET',
	'GITHUB_CLIENT_ID',
	'GITHUB_CLIENT_SECRET',
	'PAYPAL_SANDBOX_BUYER_EMAIL',
	'PAYPAL_SANDBOX_BUYER_PASSWORD'
];

/** Patterns that must not appear in tracked OSS files (real key material). */
export const OSS_FORBIDDEN_KEY_PATTERNS = [
	/\bphx_[a-zA-Z0-9]{20,}\b/,
	/\bphc_[a-zA-Z0-9]{20,}\b/,
	/\bsk-or-[a-zA-Z0-9]{20,}\b/,
	/\bsk-[a-zA-Z0-9]{20,}\b/
];

/**
 * @param {string} line
 * @returns {string}
 */
export function parseEnvExampleValue(line) {
	const match = line.match(/^[^=]+=\s*(.*)$/);
	if (!match) return '';
	let raw = match[1].trim();
	if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
		raw = raw.slice(1, -1);
	}
	return raw.trim();
}
