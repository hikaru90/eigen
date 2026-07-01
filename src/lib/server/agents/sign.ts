import crypto from 'node:crypto';
import type { SignatureMode } from '$lib/server/db/schema';

export type { SignatureMode };

/**
 * Build the raw HMAC-SHA256 hex digest for a webhook payload.
 *
 * The signed payload format varies by mode:
 * - GitHub: HMAC-SHA256(secret, body) — no timestamp prefix
 * - Generic: HMAC-SHA256(secret, body) — no timestamp prefix
 * - GitLab: not used (plain token match, no HMAC)
 */
export function buildWebhookSignature(input: {
	secret: string;
	rawBody: string;
}): string {
	return crypto.createHmac('sha256', input.secret).update(input.rawBody).digest('hex');
}

/**
 * Build the signature header value based on the signature mode.
 *
 * - GitHub: `sha256={hex}` (prefixed with sha256=)
 * - GitLab: plain secret string (not HMAC — direct token match)
 * - Generic: `{hex}` (raw hex digest)
 */
export function buildSignatureHeaderValue(input: {
	mode: SignatureMode;
	secret: string;
	rawBody: string;
}): string {
	if (input.mode === 'gitlab') {
		// GitLab uses plain token match, not HMAC
		return input.secret;
	}
	const hex = buildWebhookSignature({
		secret: input.secret,
		rawBody: input.rawBody
	});
	if (input.mode === 'github') {
		return `sha256=${hex}`;
	}
	return hex;
}

/**
 * Build outbound webhook headers matching the Hermes webhook format.
 *
 * - GitHub mode: X-Hub-Signature-256, X-GitHub-Event, X-GitHub-Delivery
 * - GitLab mode: X-Gitlab-Token, X-Gitlab-Event
 * - Generic mode: X-Webhook-Signature, X-Event-Type, X-Request-ID
 */
export function buildWebhookHeaders(input: {
	mode: SignatureMode;
	eventType: string;
	deliveryId: string;
	signature: string;
}): Record<string, string> {
	const base: Record<string, string> = {
		'Content-Type': 'application/json'
	};

	if (input.mode === 'github') {
		return {
			...base,
			'X-Hub-Signature-256': `sha256=${input.signature}`,
			'X-GitHub-Event': input.eventType,
			'X-GitHub-Delivery': input.deliveryId
		};
	}

	if (input.mode === 'gitlab') {
		return {
			...base,
			'X-Gitlab-Token': input.signature,
			'X-Gitlab-Event': input.eventType
		};
	}

	// Generic mode
	return {
		...base,
		'X-Webhook-Signature': input.signature,
		'X-Event-Type': input.eventType,
		'X-Request-ID': input.deliveryId
	};
}

/**
 * Validate an inbound webhook signature.
 *
 * - GitHub: X-Hub-Signature-256 = sha256=HMAC-SHA256(secret, body)
 * - GitLab: X-Gitlab-Token = plain secret string match
 * - Generic: X-Webhook-Signature = HMAC-SHA256(secret, body) as raw hex
 */
export function validateWebhookSignature(input: {
	mode: SignatureMode;
	secret: string;
	rawBody: string;
	receivedSignature: string;
	/** Only used by generic mode if sender includes a timestamp. Optional. */
	timestamp?: number;
}): boolean {
	if (input.mode === 'gitlab') {
		// GitLab uses plain token match (constant-time comparison)
		try {
			const a = Buffer.from(input.secret, 'utf8');
			const b = Buffer.from(input.receivedSignature, 'utf8');
			if (a.length !== b.length) return false;
			return crypto.timingSafeEqual(a, b);
		} catch {
			return false;
		}
	}

	// GitHub and Generic both use HMAC-SHA256(secret, body)
	// GitHub expects: sha256={hex}
	// Generic expects: {hex} (raw)
	const expectedHex = buildWebhookSignature({
		secret: input.secret,
		rawBody: input.rawBody
	});

	let expectedWithPrefix: string;
	if (input.mode === 'github') {
		expectedWithPrefix = `sha256=${expectedHex}`;
	} else {
		expectedWithPrefix = expectedHex;
	}

	try {
		const a = Buffer.from(expectedWithPrefix, 'utf8');
		const b = Buffer.from(input.receivedSignature, 'utf8');
		if (a.length !== b.length) return false;
		return crypto.timingSafeEqual(a, b);
	} catch {
		return false;
	}
}
