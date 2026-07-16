/**
 * Transactional email via self-hosted useSend (REST).
 * @see https://docs.usesend.com/api-reference/emails/send-email
 */

export type UseSendEnv = {
	USESEND_API_KEY?: string;
	USESEND_BASE_URL?: string;
	USESEND_EMAIL_FROM?: string;
};

export type SendTransactionalEmailInput = {
	to: string;
	subject: string;
	html: string;
	text: string;
};

export type UseSendMailConfig = {
	apiKey: string;
	baseUrl: string;
	from: string;
};

function readRequired(env: UseSendEnv, key: keyof UseSendEnv): string | undefined {
	const value = env[key]?.trim();
	return value || undefined;
}

/** Returns mail config when all three env vars are set; otherwise `null` (email features stay off). */
export function resolveUseSendMailConfig(env: UseSendEnv): UseSendMailConfig | null {
	const apiKey = readRequired(env, 'USESEND_API_KEY');
	const baseUrl = readRequired(env, 'USESEND_BASE_URL');
	const from = readRequired(env, 'USESEND_EMAIL_FROM');
	if (!apiKey || !baseUrl || !from) return null;
	return { apiKey, baseUrl: baseUrl.replace(/\/$/, ''), from };
}

export function isUseSendMailConfigured(env: UseSendEnv): boolean {
	return resolveUseSendMailConfig(env) !== null;
}

/**
 * Sends one transactional email. Throws if useSend is not configured or the API rejects the send.
 * No silent degradation — callers must only invoke this when mail is configured.
 */
export async function sendTransactionalEmail(
	env: UseSendEnv,
	input: SendTransactionalEmailInput,
	fetchImpl: typeof fetch = fetch
): Promise<{ emailId: string | null }> {
	const config = resolveUseSendMailConfig(env);
	if (!config) {
		throw new Error(
			'Transactional email is not configured (set USESEND_API_KEY, USESEND_BASE_URL, and USESEND_EMAIL_FROM)'
		);
	}

	const url = `${config.baseUrl}/api/v1/emails`;
	const response = await fetchImpl(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${config.apiKey}`
		},
		body: JSON.stringify({
			to: input.to,
			from: config.from,
			subject: input.subject,
			html: input.html,
			text: input.text
		})
	});

	const bodyText = await response.text();
	let parsed: { emailId?: string; message?: string } | null = null;
	if (bodyText) {
		try {
			parsed = JSON.parse(bodyText) as { emailId?: string; message?: string };
		} catch {
			parsed = null;
		}
	}

	if (!response.ok) {
		const detail = parsed?.message ?? (bodyText.slice(0, 500) || response.statusText);
		throw new Error(`useSend send failed (${response.status}): ${detail}`);
	}

	return { emailId: typeof parsed?.emailId === 'string' ? parsed.emailId : null };
}
