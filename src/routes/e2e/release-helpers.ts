import path from 'node:path';
import dotenv from 'dotenv';
import { expect, type Frame, type Locator, type Page } from '@playwright/test';
import { loginUser, registerUser, TEST_PASSWORD } from './test-helpers';

// Playwright workers may not inherit .env from the parent shell; load explicitly for preflight.
dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true, override: true });

export { registerUser, loginUser, TEST_PASSWORD };

const RELEASE_ENV_CHECKS: Array<{ label: string; isSet: () => boolean }> = [
	{ label: 'PAYPAL_CLIENT_ID', isSet: () => Boolean(process.env.PAYPAL_CLIENT_ID?.trim()) },
	{
		label: 'PAYPAL_CLIENT_SECRET (or PAYPAL_SECRET)',
		isSet: () =>
			Boolean(process.env.PAYPAL_CLIENT_SECRET?.trim() || process.env.PAYPAL_SECRET?.trim())
	},
	{
		label: 'PAYPAL_API_BASE (or PAYPAL_URL)',
		isSet: () => Boolean(process.env.PAYPAL_API_BASE?.trim() || process.env.PAYPAL_URL?.trim())
	},
	{
		label: 'PAYPAL_SANDBOX_BUYER_EMAIL',
		isSet: () => Boolean(process.env.PAYPAL_SANDBOX_BUYER_EMAIL?.trim())
	},
	{
		label: 'PAYPAL_SANDBOX_BUYER_PASSWORD',
		isSet: () => Boolean(process.env.PAYPAL_SANDBOX_BUYER_PASSWORD?.trim())
	},
	{
		label: 'SERVICE_API_KEY_EUROUTER',
		isSet: () => Boolean(process.env.SERVICE_API_KEY_EUROUTER?.trim())
	},
	{ label: 'LLM_BASE_URL', isSet: () => Boolean(process.env.LLM_BASE_URL?.trim()) },
	{ label: 'LLM_RULE_CHAT', isSet: () => Boolean(process.env.LLM_RULE_CHAT?.trim()) },
	{ label: 'LLM_RULE_EMBEDDING', isSet: () => Boolean(process.env.LLM_RULE_EMBEDDING?.trim()) }
];

export function getReleasePreflightMissing(): string[] {
	return RELEASE_ENV_CHECKS.filter((check) => !check.isSet()).map((check) => check.label);
}

export type AuthenticatedSurface = {
	path: string;
	label: string;
};

/** Main authenticated routes exercised before a release. */
export const AUTHENTICATED_SURFACES: AuthenticatedSurface[] = [
	{ path: '/capture', label: 'Capture' },
	{ path: '/memory', label: 'Memory graph' },
	{ path: '/memory?view=embeddings', label: 'Memory embeddings' },
	{ path: '/memory/timeline', label: 'Memory timeline' },
	{ path: '/memory/notes', label: 'Memory notes' },
	{ path: '/chat', label: 'Chat' },
	{ path: '/activity', label: 'Activity' },
	{ path: '/settings', label: 'Settings' },
	{ path: '/settings/llm', label: 'Settings LLM' },
	{ path: '/settings/scheduled-tasks', label: 'Heartbeat' },
	{ path: '/api-keys', label: 'API keys' }
];

export function assertReleasePreflight(): void {
	const missing = getReleasePreflightMissing();
	if (missing.length > 0) {
		throw new Error(
			`Release e2e preflight failed. Set these in .env before running npm run test:e2e:release:\n${missing.map((k) => `  - ${k}`).join('\n')}`
		);
	}
}

async function waitForAuthenticatedPage(page: Page, path: string): Promise<void> {
	await page.goto(path);
	await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
	await expect(page.locator('body')).toBeVisible();
}

async function openAccountMenu(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'Account menu' }).click();
}

async function dismissOpenOverlays(page: Page): Promise<void> {
	await page.keyboard.press('Escape');
}

/** Locale-neutral PayPal checkout submit controls (hermes + legacy review). */
const PAYPAL_SUBMIT_SELECTORS = [
	'#payment-submit-btn',
	'#confirmButtonTop',
	'#btn_pay',
	'#submit-action',
	'button[data-testid="submit-button-initial"]',
	'button[data-testid="submit-button"]',
	'button[name="payment-submit"]',
	'input#payment-submit-btn',
	'button.actionContinue',
	'button[id*="submit" i]',
	'input[type="submit"]',
	'button[type="submit"]'
] as const;

async function isVisible(locator: Locator, timeoutMs = 1_500): Promise<boolean> {
	return locator.isVisible({ timeout: timeoutMs }).catch(() => false);
}

async function maybeLoginPayPalSandbox(
	checkoutPage: Page,
	buyerEmail: string,
	buyerPassword: string
): Promise<void> {
	const emailInput = checkoutPage.locator('#email, input[name="login_email"]').first();
	if (!(await isVisible(emailInput, 8_000))) {
		return;
	}

	await emailInput.fill(buyerEmail);

	const nextButton = checkoutPage.locator('#btnNext').first();
	if (await isVisible(nextButton)) {
		await nextButton.click();
	}

	const passwordInput = checkoutPage.locator('#password, input[name="login_password"]').first();
	await passwordInput.waitFor({ state: 'visible', timeout: 20_000 });
	await passwordInput.fill(buyerPassword);

	await checkoutPage.locator('#btnLogin').first().click();
	await waitForPayPalCheckoutReady(checkoutPage);
}

function paypalContexts(checkoutPage: Page): Array<Page | Frame> {
	return [checkoutPage, ...checkoutPage.frames()];
}

async function paypalCheckoutReady(checkoutPage: Page): Promise<boolean> {
	if (checkoutPage.isClosed()) {
		return false;
	}

	const url = checkoutPage.url();
	if (!url || url === 'about:blank' || !/sandbox\.paypal\.com/i.test(url)) {
		return false;
	}

	for (const ctx of paypalContexts(checkoutPage)) {
		const signals = [
			ctx.locator('#email, input[name="login_email"]').first(),
			ctx.locator('#password, input[name="login_password"]').first(),
			ctx.locator('#payment-submit-btn').first(),
			ctx.locator('button[data-testid="submit-button-initial"]').first(),
			ctx.locator('input[type="radio"]').first()
		];
		for (const signal of signals) {
			if (await signal.isVisible().catch(() => false)) {
				return true;
			}
		}

		const buttons = ctx.locator('button:visible:not([disabled])');
		const count = await buttons.count();
		for (let i = count - 1; i >= 0; i--) {
			const box = await buttons.nth(i).boundingBox();
			if (box && box.height >= 36 && box.width >= 80) {
				return true;
			}
		}
	}

	return false;
}

async function waitForPayPalCheckoutReady(checkoutPage: Page): Promise<void> {
	await expect
		.poll(() => paypalCheckoutReady(checkoutPage), {
			timeout: 90_000,
			intervals: [300, 500, 1000]
		})
		.toBe(true);

	if (checkoutPage.isClosed()) {
		throw new Error('PayPal checkout closed before it finished loading');
	}
}

async function closeStrayPayPalPopups(mainPage: Page): Promise<void> {
	for (const p of mainPage.context().pages()) {
		if (p !== mainPage && !p.isClosed()) {
			await p.close().catch(() => undefined);
		}
	}
}

function payPalApiBase(): string {
	const base = (process.env.PAYPAL_API_BASE ?? process.env.PAYPAL_URL)?.trim().replace(/\/$/, '');
	if (!base) {
		throw new Error('PAYPAL_API_BASE (or PAYPAL_URL) is required for release PayPal polling');
	}
	return base;
}

let cachedPayPalToken: { token: string; expiresAt: number } | null = null;

async function getPayPalAccessTokenForE2e(): Promise<string> {
	const now = Date.now();
	if (cachedPayPalToken && cachedPayPalToken.expiresAt > now + 30_000) {
		return cachedPayPalToken.token;
	}

	const clientId = process.env.PAYPAL_CLIENT_ID?.trim();
	const secret = (process.env.PAYPAL_CLIENT_SECRET ?? process.env.PAYPAL_SECRET)?.trim();
	if (!clientId || !secret) {
		throw new Error('PayPal client credentials are required for release PayPal polling');
	}

	const credentials = Buffer.from(`${clientId}:${secret}`).toString('base64');
	const res = await fetch(`${payPalApiBase()}/v1/oauth2/token`, {
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
	const json = JSON.parse(text) as { access_token?: string; expires_in?: number };
	if (!json.access_token) {
		throw new Error('PayPal OAuth response missing access_token');
	}
	cachedPayPalToken = {
		token: json.access_token,
		expiresAt: now + (json.expires_in ?? 300) * 1000
	};
	return json.access_token;
}

async function getPayPalOrderStatus(orderId: string): Promise<string> {
	const token = await getPayPalAccessTokenForE2e();
	const res = await fetch(
		`${payPalApiBase()}/v2/checkout/orders/${encodeURIComponent(orderId)}`,
		{ headers: { Authorization: `Bearer ${token}` } }
	);
	const text = await res.text();
	if (!res.ok) {
		throw new Error(`PayPal get order failed HTTP ${res.status}: ${text.slice(0, 300)}`);
	}
	const json = JSON.parse(text) as { status?: string };
	return json.status?.trim() ?? '';
}

async function waitForPayPalOrderApproved(orderId: string, timeoutMs = 90_000): Promise<void> {
	await expect
		.poll(() => getPayPalOrderStatus(orderId), {
			timeout: timeoutMs,
			intervals: [500, 1000, 2000]
		})
		.toMatch(/APPROVED|COMPLETED/i);
}

async function selectPayPalFundingIfNeeded(checkoutPage: Page): Promise<void> {
	for (const ctx of paypalContexts(checkoutPage)) {
		const radio = ctx.locator('input[type="radio"]:visible').first();
		if (await radio.isVisible().catch(() => false)) {
			await radio.check({ force: true }).catch(() => radio.click({ force: true }));
			return;
		}
	}
}

const PAYPAL_SANDBOX_CHECKOUT_ORIGIN = 'https://www.sandbox.paypal.com';

/** Approve an existing order in sandbox UI (bypasses flaky JS SDK popup bridge). */
async function approvePayPalOrderInSandbox(
	mainPage: Page,
	orderId: string,
	buyerEmail: string,
	buyerPassword: string
): Promise<void> {
	const checkoutPage = await mainPage.context().newPage();
	try {
		await checkoutPage.goto(
			`${PAYPAL_SANDBOX_CHECKOUT_ORIGIN}/checkoutnow?token=${encodeURIComponent(orderId)}`,
			{ waitUntil: 'domcontentloaded', timeout: 60_000 }
		);
		await waitForPayPalCheckoutReady(checkoutPage);
		await maybeLoginPayPalSandbox(checkoutPage, buyerEmail, buyerPassword);
		await selectPayPalFundingIfNeeded(checkoutPage);

		let status = await getPayPalOrderStatus(orderId).catch(() => '');
		for (let attempt = 0; attempt < 3 && !/APPROVED|COMPLETED/i.test(status); attempt++) {
			await selectPayPalFundingIfNeeded(checkoutPage);
			if (await paypalCheckoutReady(checkoutPage)) {
				await clickPayPalSubmitButton(checkoutPage);
			}
			status = await getPayPalOrderStatus(orderId).catch(() => status);
		}

		await waitForPayPalOrderApproved(orderId);
	} finally {
		await checkoutPage.close().catch(() => undefined);
	}
}

async function clickPayPalSubmitButton(checkoutPage: Page): Promise<void> {
	await expect
		.poll(async () => {
			for (const ctx of paypalContexts(checkoutPage)) {
				for (const selector of PAYPAL_SUBMIT_SELECTORS) {
					if (await ctx.locator(selector).first().isVisible().catch(() => false)) {
						return true;
					}
				}
				const buttons = ctx.locator('button:visible:not([disabled])');
				const count = await buttons.count();
				for (let i = count - 1; i >= 0; i--) {
					const box = await buttons.nth(i).boundingBox();
					if (box && box.height >= 36 && box.width >= 120) {
						return true;
					}
				}
			}
			return false;
		}, { timeout: 60_000, intervals: [250, 500, 1000] })
		.toBe(true);

	for (const ctx of paypalContexts(checkoutPage)) {
		for (const selector of PAYPAL_SUBMIT_SELECTORS) {
			const button = ctx.locator(selector).first();
			if (await isVisible(button, 1_000)) {
				await button.click();
				return;
			}
		}
	}

	for (const ctx of paypalContexts(checkoutPage)) {
		const buttons = ctx.locator('button:visible:not([disabled])');
		const count = await buttons.count();
		for (let i = count - 1; i >= 0; i--) {
			const button = buttons.nth(i);
			const box = await button.boundingBox();
			if (box && box.height >= 36 && box.width >= 120) {
				await button.click();
				return;
			}
		}
	}

	throw new Error('PayPal submit button not found (checkout may have changed)');
}

/**
 * Buy sandbox credits: create-order API → sandbox buyer approval → capture-order.
 *
 * Skips the PayPal JS SDK button — its popup auto-cancels under automation and leaves
 * the wallet at 0 (Capture stays disabled).
 */
export async function topUpCreditsViaPayPalSandbox(
	page: Page,
	options?: { amountCredits?: number }
): Promise<void> {
	const amountCredits = options?.amountCredits ?? 1000;
	const buyerEmail = process.env.PAYPAL_SANDBOX_BUYER_EMAIL?.trim();
	const buyerPassword = process.env.PAYPAL_SANDBOX_BUYER_PASSWORD?.trim();
	if (!buyerEmail || !buyerPassword) {
		throw new Error('PAYPAL_SANDBOX_BUYER_EMAIL and PAYPAL_SANDBOX_BUYER_PASSWORD are required');
	}

	await closeStrayPayPalPopups(page);

	const createRes = await page.request.post('/api/billing/paypal/create-order', {
		data: { amountCredits },
		headers: { 'Content-Type': 'application/json' }
	});
	if (!createRes.ok()) {
		throw new Error(`create-order failed (${createRes.status()}): ${await createRes.text()}`);
	}

	const orderPayload = (await createRes.json()) as { orderId?: string };
	const orderId = typeof orderPayload.orderId === 'string' ? orderPayload.orderId.trim() : '';
	if (!orderId) {
		throw new Error('create-order response missing orderId');
	}

	await approvePayPalOrderInSandbox(page, orderId, buyerEmail, buyerPassword);
	await closeStrayPayPalPopups(page);

	const captureRes = await page.request.post('/api/billing/paypal/capture-order', {
		data: { orderId },
		headers: { 'Content-Type': 'application/json' }
	});
	if (!captureRes.ok()) {
		throw new Error(`capture-order failed (${captureRes.status()}): ${await captureRes.text()}`);
	}

	await page.reload();

	await expect
		.poll(async () => {
			const walletRes = await page.request.get('/api/billing/wallet');
			if (!walletRes.ok()) return 0;
			const body = (await walletRes.json()) as { availableCredits?: number };
			return body.availableCredits ?? 0;
		}, { timeout: 15_000 })
		.toBeGreaterThanOrEqual(50);
}

function onboardingDialog(page: Page): Locator {
	return page.getByRole('dialog', { name: 'Welcome to Eigen' });
}

/** Welcome is step 1/3 in the UI (internal step index 0). */
async function advanceOnboardingToCreditsStep(dialog: Locator): Promise<void> {
	if (await dialog.getByText('Step 1 of 3').isVisible().catch(() => false)) {
		await dialog.getByRole('button', { name: 'Next' }).click();
		await expect(dialog.getByText('Step 2 of 3')).toBeVisible({ timeout: 15_000 });
	}
}

/**
 * Step through the welcome overlay: credits (PayPal) → ready → Get started.
 */
export async function completeOnboardingOverlay(
	page: Page,
	options?: { creditAmount?: number }
): Promise<void> {
	const dialog = onboardingDialog(page);
	await expect(dialog).toBeVisible();

	await advanceOnboardingToCreditsStep(dialog);

	await topUpCreditsViaPayPalSandbox(page, {
		amountCredits: options?.creditAmount ?? 1000
	});

	await expect(dialog).toBeVisible({ timeout: 15_000 });
	// Reload after capture resets the overlay to step 1; advance again with fresh wallet data.
	await advanceOnboardingToCreditsStep(dialog);
	await expect(dialog.getByText('Enough credits to capture.')).toBeVisible({ timeout: 30_000 });

	await dialog.getByRole('button', { name: 'Next' }).click();
	await expect(dialog.getByText('Step 3 of 3')).toBeVisible({ timeout: 10_000 });
	await dialog.getByRole('button', { name: 'Get started' }).click();

	await expect(dialog).toBeHidden({ timeout: 15_000 });
}

export async function captureThoughtViaUi(page: Page, raw: string): Promise<void> {
	await page.goto('/capture');
	await expect(onboardingDialog(page)).toBeHidden({ timeout: 15_000 });
	await expect(page.getByText('Before your first capture')).toBeHidden({ timeout: 15_000 });

	await page.locator('#thought').fill(raw);

	const captureBtn = page.getByRole('button', { name: 'Capture', exact: true });
	await expect(captureBtn).toBeEnabled({ timeout: 30_000 });

	const errorBanner = page.locator('p.text-destructive.text-sm').first();
	await captureBtn.click();

	await expect
		.poll(
			async () => {
				if (await errorBanner.isVisible().catch(() => false)) {
					const message = (await errorBanner.textContent())?.trim();
					throw new Error(message ? `Capture failed: ${message}` : 'Capture failed');
				}
				if (await page.getByText('Stored thought').isVisible().catch(() => false)) {
					return true;
				}
				return false;
			},
			{ timeout: 120_000, intervals: [500, 1000, 2000] }
		)
		.toBe(true);
}

export async function visitAuthenticatedSurfaces(page: Page): Promise<void> {
	await exerciseAuthenticatedUi(page);
}

/** Click through primary chrome, tabs, filters, and non-destructive dialogs. */
export async function exerciseAuthenticatedUi(page: Page): Promise<void> {
	for (const surface of AUTHENTICATED_SURFACES) {
		await waitForAuthenticatedPage(page, surface.path);
	}

	await exerciseBottomNav(page);
	await exerciseAccountMenu(page);
	await exerciseMemoryUi(page);
	await exerciseCaptureUi(page);
	await exerciseChatUi(page);
	await exerciseSettingsUi(page);
	await exerciseApiKeysUi(page);
	await exerciseActivityUi(page);
	await exerciseLegacyRedirects(page);
}

async function exerciseBottomNav(page: Page): Promise<void> {
	for (const label of ['Memory', 'Capture', 'Chat'] as const) {
		await page.getByRole('link', { name: label, exact: true }).click();
		await expect(page).not.toHaveURL(/\/login/);
	}
}

async function exerciseAccountMenu(page: Page): Promise<void> {
	await page.goto('/capture');
	await openAccountMenu(page);

	for (const item of ['Activity', 'API Keys', 'LLM', 'Heartbeat', 'Settings'] as const) {
		await page.getByRole('link', { name: item, exact: true }).click();
		await expect(page).not.toHaveURL(/\/login/);
		await openAccountMenu(page);
	}

	const evalLink = page.getByRole('link', { name: 'Evals', exact: true });
	if (await evalLink.isVisible().catch(() => false)) {
		await evalLink.click();
		await expect(page).toHaveURL(/\/eval/);
		await page.goto('/capture');
	}
}

async function exerciseMemoryUi(page: Page): Promise<void> {
	await page.goto('/memory');

	for (const tab of ['Graph', 'Embeddings', 'Timeline', 'Notes'] as const) {
		await page.getByRole('link', { name: tab, exact: true }).click();
		await expect(page).not.toHaveURL(/\/login/);
	}

	await page.getByRole('link', { name: 'Graph', exact: true }).click();
	await exerciseGraphFilters(page);

	await page.getByRole('link', { name: 'Timeline', exact: true }).click();
	for (const tab of ['Tasks', 'Projects'] as const) {
		await page.getByRole('tab', { name: tab, exact: true }).click();
	}
	for (const segment of ["Today's tasks", 'Done today', 'Overdue'] as const) {
		const segTab = page.getByRole('tab', { name: segment, exact: true });
		if (await segTab.isVisible().catch(() => false)) {
			await segTab.click();
		}
	}

	await page.getByRole('link', { name: 'Notes', exact: true }).click();
	const newNote = page.getByRole('button', { name: 'New note', exact: true });
	if (await newNote.isVisible().catch(() => false)) {
		await newNote.click();
		await expect(page.getByRole('dialog')).toBeVisible();
		await dismissOpenOverlays(page);
	}
}

async function exerciseGraphFilters(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'Search nodes', exact: true }).click();
	await page.locator('#graph-search').fill('Lisbon');
	await dismissOpenOverlays(page);

	await page.getByRole('button', { name: 'Edge type filter', exact: true }).click();
	const coMention = page.getByRole('option', { name: 'Co-mentioned' });
	if (await coMention.isVisible().catch(() => false)) {
		await coMention.click();
	}
	await dismissOpenOverlays(page);

	await page.getByRole('button', { name: 'Community level filter', exact: true }).click();
	await dismissOpenOverlays(page);

	const entityFilter = page.getByRole('button', { name: 'Entity type filter', exact: true });
	if (await entityFilter.isVisible().catch(() => false)) {
		await entityFilter.click();
		await dismissOpenOverlays(page);
	}
}

async function exerciseCaptureUi(page: Page): Promise<void> {
	await page.goto('/capture');

	const expand = page.getByRole('button', { name: 'Expand thought' }).first();
	if (await expand.isVisible().catch(() => false)) {
		await expand.click();
		await page.getByRole('button', { name: 'Collapse thought' }).first().click();
	}
}

async function exerciseChatUi(page: Page): Promise<void> {
	await page.goto('/chat');

	await page.getByRole('button', { name: 'Toggle session list' }).click();
	await page.getByRole('button', { name: 'New chat', exact: true }).click();
	await page.getByRole('button', { name: 'Close sidebar' }).click();

	const input = page.getByPlaceholder('Ask a question about your memories...');
	await input.fill('What city did I mention in my recent capture?');
	await input.press('Enter');

	await expect(page.getByRole('button', { name: 'Regenerate answer' })).toBeVisible({
		timeout: 120_000
	});
}

async function exerciseSettingsUi(page: Page): Promise<void> {
	await page.goto('/settings');

	for (const tab of [
		'Appearance',
		'Speech',
		'Account',
		'Notifications',
		'Memory',
		'Danger zone'
	] as const) {
		await page.getByRole('tab', { name: tab, exact: true }).click();
	}

	await page.goto('/settings/llm');
	await expect(page).not.toHaveURL(/\/login/);

	await page.goto('/settings/scheduled-tasks');
	await expect(page).not.toHaveURL(/\/login/);
}

async function exerciseApiKeysUi(page: Page): Promise<void> {
	await page.goto('/api-keys');
	await page.getByRole('button', { name: 'Generate new key', exact: true }).click();
	await page.getByRole('button', { name: 'Cancel' }).click();
}

async function exerciseActivityUi(page: Page): Promise<void> {
	await page.goto('/activity');
	await expect(page.locator('table')).toBeVisible({ timeout: 15_000 });
	await expect(page.locator('tbody tr').first()).toBeVisible();
}

async function exerciseLegacyRedirects(page: Page): Promise<void> {
	await page.goto('/graph');
	await expect(page).toHaveURL(/\/memory/);
}
