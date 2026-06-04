/** PayPal JS SDK v6 integration (docs: https://docs.paypal.ai/developer/how-to/sdk/js/v6/configuration) */

type PayPalPaymentSession = {
	start: (
		options: { presentationMode: string },
		/** v6 expects a Promise (e.g. `createOrder()`), not a callback — see PayPal JS SDK v6 docs */
		createOrder: Promise<{ orderId: string }>
	) => Promise<void>;
};

type PayPalSdkInstance = {
	findEligibleMethods: (input: { currencyCode: string }) => Promise<{
		isEligible: (method: string) => boolean;
		getDetails?: (method: string) => unknown;
	}>;
	createPayPalOneTimePaymentSession: (options: {
		onApprove: (data: { orderId: string }) => Promise<void>;
		onCancel?: (data: unknown) => void;
		onError?: (error: unknown) => void;
	}) => PayPalPaymentSession;
};

declare global {
	interface Window {
		paypal?: {
			createInstance: (options: {
				clientId: string;
				components?: string[];
				pageType?: string;
				locale?: string;
				clientMetadataId?: string;
				merchantId?: string;
			}) => Promise<PayPalSdkInstance>;
		};
	}
}

/** Ensures concurrent callers await the same load + API availability. */
const loadOnceBySdkUrl = new Map<string, Promise<void>>();

function normalizeSdkUrlHint(url: string): string {
	try {
		const u = new URL(url.trim());
		return `${u.origin}${u.pathname}`;
	} catch {
		return url.trim().replace(/\/?$/, '');
	}
}

function isV6CoreScriptUrl(candidate: URL, desiredOrigin: string): boolean {
	if (candidate.origin !== desiredOrigin) return false;
	return /\/web-sdk\/v6\/core\/?$/i.test(candidate.pathname);
}

function findExistingV6CoreScript(desiredNormalized: string): HTMLScriptElement | null {
	let desiredOrigin: string;
	try {
		desiredOrigin = new URL(desiredNormalized).origin;
	} catch {
		return null;
	}
	for (const s of Array.from(document.querySelectorAll('script[src]'))) {
		const raw = (s as HTMLScriptElement).src?.trim();
		if (!raw) continue;
		try {
			const u = new URL(raw);
			if (isV6CoreScriptUrl(u, desiredOrigin)) return s as HTMLScriptElement;
		} catch {
			continue;
		}
	}
	return null;
}

/**
 * Wait for v6 bootstrap: core script fires `load` before `window.paypal.createInstance`
 * exists (bundles hydrate asynchronously — see paypal-examples v6 repo).
 */
function waitForCreateInstance(timeoutMs = 20_000, intervalMs = 50): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	return new Promise((resolve, reject) => {
		function tick() {
			const fn = typeof window !== 'undefined' ? window.paypal?.createInstance : undefined;
			if (typeof fn === 'function') {
				resolve();
				return;
			}
			if (Date.now() >= deadline) {
				reject(
					new Error(
						'PayPal SDK script ran but `window.paypal.createInstance` did not appear. Check sandbox vs live: PAYPAL_WEB_SDK_URL must match your PAYPAL_CLIENT_ID environment (sandbox script + sandbox REST base). See https://docs.paypal.ai/developer/how-to/sdk/js/v6/configuration'
					)
				);
				return;
			}
			setTimeout(tick, intervalMs);
		}
		tick();
	});
}

export async function loadPayPalSdkScript(sdkUrl: string): Promise<void> {
	const normalized = normalizeSdkUrlHint(sdkUrl);
	let job = loadOnceBySdkUrl.get(normalized);
	if (!job) {
		job = (async () => {
			const existing = findExistingV6CoreScript(normalized);

			if (!existing) {
				await new Promise<void>((resolve, reject) => {
					const script = document.createElement('script');
					script.src = normalized;
					script.async = true;
					script.crossOrigin = 'anonymous';
					script.onload = () => resolve();
					script.onerror = () =>
						reject(new Error(`Failed to load PayPal SDK from ${normalized}`));
					document.head.appendChild(script);
				});
			}

			await waitForCreateInstance();
		})();

		loadOnceBySdkUrl.set(normalized, job);

		job.catch(() => {
			loadOnceBySdkUrl.delete(normalized);
		});
	}

	await job;
}

export async function initPayPalCheckout(input: {
	clientId: string;
	sdkUrl: string;
	currencyCode: string;
	getAmountCents: () => number;
	onBalanceUpdated: () => void;
	onStatus: (message: string) => void;
	onError: (message: string) => void;
	button: HTMLElement;
}): Promise<() => void> {
	await loadPayPalSdkScript(input.sdkUrl);

	const paypal = window.paypal;
	if (!paypal?.createInstance) {
		throw new Error('PayPal SDK is not initialized');
	}

	const currencyCode = input.currencyCode.trim().toUpperCase();
	if (!/^[A-Z]{3}$/.test(currencyCode)) {
		throw new Error(`Invalid billing currency code: ${input.currencyCode}`);
	}

	const clientMetadataId =
		typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
			? crypto.randomUUID()
			: undefined;

	const sdkInstance = await paypal.createInstance({
		clientId: input.clientId,
		components: ['paypal-payments'],
		pageType: 'checkout',
		...(clientMetadataId !== undefined ? { clientMetadataId } : {})
	});

	const methods = await sdkInstance.findEligibleMethods({ currencyCode });
	if (!methods.isEligible('paypal')) {
		throw new Error(
			`PayPal wallet checkout is not available for ${currencyCode} in this browser (eligibility declined). Ensure you use sandbox Client ID + https://www.sandbox.paypal.com/web-sdk/v6/core with REST base api-m.sandbox.paypal.com — or override PAYPAL_WEB_SDK_URL. Docs: https://docs.paypal.ai/developer/how-to/sdk/js/v6/configuration`
		);
	}

	const session = sdkInstance.createPayPalOneTimePaymentSession({
		async onApprove(data) {
			input.onStatus('Capturing payment…');
			const res = await fetch('/api/billing/paypal/capture-order', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ orderId: data.orderId })
			});
			const body = await res.json().catch(() => null);
			if (!res.ok) {
				throw new Error(typeof body?.error === 'string' ? body.error : `Capture failed (${res.status})`);
			}
			if (typeof body?.availableCents === 'number') {
				input.onBalanceUpdated(body.availableCents);
			}
			input.onStatus('Credits added to your account.');
		},
		onCancel() {
			input.onStatus('Payment cancelled.');
		},
		onError(err) {
			input.onError(err instanceof Error ? err.message : 'Payment failed');
		}
	});

	const handler = async () => {
		const amountCents = input.getAmountCents();
		if (!Number.isInteger(amountCents) || amountCents < 100) {
			input.onError('Enter at least 1.00 in your billing currency.');
			return;
		}
		input.onStatus('Opening PayPal…');
		try {
			await session.start(
				{ presentationMode: 'auto' },
				(async () => {
					const res = await fetch('/api/billing/paypal/create-order', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							amountCents,
							currency: currencyCode
						})
					});
					const body = await res.json().catch(() => null);
					if (!res.ok || typeof body?.orderId !== 'string') {
						throw new Error(
							typeof body?.error === 'string' ? body.error : `Create order failed (${res.status})`
						);
					}
					return { orderId: body.orderId };
				})()
			);
		} catch (e) {
			input.onError(e instanceof Error ? e.message : String(e));
		}
	};

	input.button.addEventListener('click', handler);
	return () => input.button.removeEventListener('click', handler);
}
