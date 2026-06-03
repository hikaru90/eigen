import { env } from '$env/dynamic/private';
import { centsToPayPalAmountValue } from '$lib/server/billing/money';

type PayPalAccessToken = { access_token: string; expires_in: number };

let cachedToken: { token: string; expiresAt: number } | null = null;

export function getPayPalApiBase(): string {
	// Backwards compatible with older env naming:
	// - PAYPAL_API_BASE (preferred)
	// - PAYPAL_URL (alias)
	const base = (env.PAYPAL_API_BASE ?? env.PAYPAL_URL)?.trim();
	if (!base) {
		throw new Error('PayPal base URL is required (set PAYPAL_API_BASE or PAYPAL_URL)');
	}
	const normalized = base.replace(/\/$/, '');
	const lower = normalized.toLowerCase();
	// Common misconfiguration: website host instead of REST API (causes OAuth 401 / capture 404).
	if (
		(lower.includes('sandbox.paypal.com') || lower.includes('www.paypal.com')) &&
		!lower.includes('api-m.')
	) {
		throw new Error(
			'PAYPAL_API_BASE must be the PayPal REST host (sandbox: https://api-m.sandbox.paypal.com, live: https://api-m.paypal.com), not the marketing site https://sandbox.paypal.com'
		);
	}
	return normalized;
}

export function getPayPalClientId(): string {
	const id = env.PAYPAL_CLIENT_ID?.trim();
	if (!id) {
		throw new Error('PAYPAL_CLIENT_ID is required');
	}
	return id;
}

export function getPayPalClientSecret(): string {
	// Backwards compatible with older env naming:
	// - PAYPAL_CLIENT_SECRET (preferred)
	// - PAYPAL_SECRET (alias)
	const secret = (env.PAYPAL_CLIENT_SECRET ?? env.PAYPAL_SECRET)?.trim();
	if (!secret) {
		throw new Error('PayPal client secret is required (set PAYPAL_CLIENT_SECRET or PAYPAL_SECRET)');
	}
	return secret;
}

/** v6 script URLs per https://docs.paypal.ai/developer/how-to/sdk/js/v6/configuration */
const PAYPAL_SDK_V6_LIVE = 'https://www.paypal.com/web-sdk/v6/core';
const PAYPAL_SDK_V6_SANDBOX = 'https://www.sandbox.paypal.com/web-sdk/v6/core';

export function getPayPalWebSdkUrl(): string {
	const override = env.PAYPAL_WEB_SDK_URL?.trim();
	if (override) {
		return override.replace(/\/$/, '');
	}

	const truthy = (v: string | undefined) => v === '1' || v?.toLowerCase() === 'true';
	if (truthy(env.PAYPAL_USE_SANDBOX_SDK)) {
		return PAYPAL_SDK_V6_SANDBOX;
	}
	if (truthy(env.PAYPAL_USE_LIVE_SDK)) {
		return PAYPAL_SDK_V6_LIVE;
	}

	const base = getPayPalApiBase().toLowerCase();
	const looksSandbox =
		base.includes('sandbox') || base.includes('api-m.sandbox') || base.includes('sandbox.paypal');
	return looksSandbox ? PAYPAL_SDK_V6_SANDBOX : PAYPAL_SDK_V6_LIVE;
}

async function getAccessToken(): Promise<string> {
	const now = Date.now();
	if (cachedToken && cachedToken.expiresAt > now + 30_000) {
		return cachedToken.token;
	}

	const base = getPayPalApiBase();
	const credentials = Buffer.from(`${getPayPalClientId()}:${getPayPalClientSecret()}`).toString('base64');
	const res = await fetch(`${base}/v1/oauth2/token`, {
		method: 'POST',
		headers: {
			Authorization: `Basic ${credentials}`,
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: 'grant_type=client_credentials'
	});
	const text = await res.text();
	if (!res.ok) {
		throw new Error(`PayPal OAuth failed HTTP ${res.status}: ${text.slice(0, 300)}`);
	}
	const json = JSON.parse(text) as PayPalAccessToken;
	if (!json.access_token) {
		throw new Error('PayPal OAuth response missing access_token');
	}
	cachedToken = {
		token: json.access_token,
		expiresAt: now + (json.expires_in ?? 300) * 1000
	};
	return json.access_token;
}

async function paypalFetch(path: string, init: RequestInit): Promise<unknown> {
	const token = await getAccessToken();
	const res = await fetch(`${getPayPalApiBase()}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
			...(init.headers ?? {})
		}
	});
	const text = await res.text();
	let json: unknown;
	try {
		json = JSON.parse(text) as unknown;
	} catch {
		json = { raw: text };
	}
	if (!res.ok) {
		throw new Error(`PayPal API ${path} HTTP ${res.status}: ${text.slice(0, 500)}`);
	}
	return json;
}

export type PayPalCreateOrderResult = {
	id: string;
	status: string;
};

export async function createPayPalOrder(input: {
	amountCents: number;
	currency: string;
}): Promise<PayPalCreateOrderResult> {
	const value = centsToPayPalAmountValue(input.amountCents);
	const body = {
		intent: 'CAPTURE',
		purchase_units: [
			{
				amount: {
					currency_code: input.currency,
					value
				}
			}
		]
	};
	const json = (await paypalFetch('/v2/checkout/orders', {
		method: 'POST',
		body: JSON.stringify(body)
	})) as { id?: string; status?: string };
	if (!json.id) {
		throw new Error('PayPal create order response missing id');
	}
	return { id: json.id, status: json.status ?? 'CREATED' };
}

export type PayPalCaptureResult = {
	id: string;
	status: string;
	payerEmail: string | null;
	capturedCents: number;
	currency: string;
	raw: Record<string, unknown>;
};

export async function capturePayPalOrder(orderId: string): Promise<PayPalCaptureResult> {
	const json = (await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
		method: 'POST'
	})) as Record<string, unknown>;

	const status = typeof json.status === 'string' ? json.status : '';
	const purchaseUnits = json.purchase_units;
	const unit = Array.isArray(purchaseUnits) ? purchaseUnits[0] : null;
	const captures = unit && typeof unit === 'object' ? (unit as { payments?: { captures?: unknown[] } }).payments?.captures : undefined;
	const capture = Array.isArray(captures) && captures[0] && typeof captures[0] === 'object' ? captures[0] : null;
	const amount =
		capture && typeof capture === 'object'
			? (capture as { amount?: { currency_code?: string; value?: string } }).amount
			: undefined;

	const currency = amount?.currency_code?.trim() ?? 'USD';
	const valueStr = amount?.value?.trim() ?? '0';
	const capturedCents = Math.round(Number(valueStr) * 100);
	if (!Number.isFinite(capturedCents) || capturedCents < 1) {
		throw new Error('PayPal capture amount missing or invalid');
	}

	const payer = json.payer;
	const payerEmail =
		payer && typeof payer === 'object' && typeof (payer as { email_address?: string }).email_address === 'string'
			? (payer as { email_address: string }).email_address
			: null;

	return {
		id: typeof json.id === 'string' ? json.id : orderId,
		status,
		payerEmail,
		capturedCents,
		currency,
		raw: json
	};
}

/** Infer checkout currency from PayPal order details (before capture). */
export async function getPayPalOrderCurrency(orderId: string): Promise<string | null> {
	const json = (await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
		method: 'GET'
	})) as {
		purchase_units?: Array<{ amount?: { currency_code?: string } }>;
	};
	const code = json.purchase_units?.[0]?.amount?.currency_code;
	return code?.trim() ? code.trim().toUpperCase() : null;
}
