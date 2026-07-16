import path from 'node:path';
import dotenv from 'dotenv';
import { expect, type Frame, type Locator, type Page } from '@playwright/test';
import {
	assertChatLoadingVisible,
	assertChatLogHasNoRawJson,
	askChatQuestion,
	loginUser,
	registerUser,
	startNewChatSession,
	TEST_PASSWORD,
	waitForChatAnswerMarker,
	waitForChatIdle
} from './test-helpers';
import {
	assertVoiceTranscribeApi,
	exerciseVoiceCaptureUi,
	installVoiceCaptureMocks
} from './voice-capture-helpers';

// Playwright workers may not inherit .env from the parent shell; load explicitly for preflight.
dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true, override: true });

export { registerUser, loginUser, TEST_PASSWORD };

/** Max wait for release smoke polls and async UI steps. */
const RELEASE_WAIT_MS = 30_000;
/** Overnight heartbeat runs many jobs; allow longer than generic UI polls. */
const RELEASE_HEARTBEAT_WAIT_MS = 120_000;
/** Background enrich (entities, GTD link, embeddings) — the one place we wait longer. */
const RELEASE_INDEXING_WAIT_MS = 120_000;
/** Single UI probe — fail fast, try the next strategy. */
const QUICK_MS = 1_500;
/** One interactive attempt (open dialog, click save, …). */
const ACTION_MS = 6_000;

/** Locale-neutral timeline project UI labels (EN + DE). */
const PROJECTS_TAB = /^(Projects|Projekte)$/;
const ADD_PROJECT_BTN = /Add project|Projekt anlegen/i;
const CREATE_PROJECT_SUBMIT = /Create project|Projekt anlegen/i;
const EDIT_PROJECT_BTN = /Edit project|Projekt bearbeiten/i;
const SAVE_PROJECT_BTN = /Save changes|Änderungen speichern/i;
const OPEN_PROJECT_BTN = /^Open$|^Öffnen$/i;
const DELETE_PROJECT_BTN = /^Delete$|^Löschen$/i;
const DELETE_PROJECT_CONFIRM_TITLE = /Delete project\?|Projekt löschen\?/i;
const PROJECTS_LISTBOX = /Projects and next actions|Projekte und nächste Schritte/i;
const DIALOG_CANCEL_BTN = /Cancel|Abbrechen/i;

async function visible(locator: Locator, timeoutMs = QUICK_MS): Promise<boolean> {
	return locator.isVisible({ timeout: timeoutMs }).catch(() => false);
}

async function pollUntil(
	label: string,
	predicate: () => Promise<boolean>,
	options?: { timeoutMs?: number; intervalMs?: number }
): Promise<void> {
	const timeoutMs = options?.timeoutMs ?? RELEASE_WAIT_MS;
	const intervalMs = options?.intervalMs ?? 750;
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await predicate()) return;
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	throw new Error(`${label} (not ready within ${timeoutMs}ms)`);
}

type CaptureThoughtRow = {
	id: string;
	normalizedText?: string;
	enrichmentComplete?: boolean;
	queueStatus?: string | null;
	queueError?: string | null;
};

async function fetchCaptureThoughtResult(
	page: Page,
	thoughtId: string
): Promise<CaptureThoughtRow | null> {
	return page.evaluate(async (id) => {
		const res = await fetch(`/api/capture/result/${encodeURIComponent(id)}`);
		if (!res.ok) return null;
		const body = (await res.json()) as { thought?: CaptureThoughtRow };
		return body.thought ?? null;
	}, thoughtId);
}

function parseCaptureSubmitThoughtId(bodyText: string, contentType: string): string {
	if (contentType.includes('application/x-ndjson')) {
		let thoughtId = '';
		for (const line of bodyText.split('\n')) {
			const trimmedLine = line.trim();
			if (!trimmedLine) continue;
			const obj = JSON.parse(trimmedLine) as {
				type?: string;
				thought?: { id?: string };
				error?: string;
			};
			if (obj.type === 'error') {
				throw new Error(obj.error ?? 'Capture failed');
			}
			if (obj.type === 'done' && obj.thought?.id) {
				thoughtId = obj.thought.id;
			}
		}
		return thoughtId;
	}

	const json = JSON.parse(bodyText) as { thought?: { id?: string }; error?: string };
	if (json.error) {
		throw new Error(json.error);
	}
	return json.thought?.id ?? '';
}

function captureIndexingInFlight(thought: CaptureThoughtRow | null): boolean {
	if (!thought || thought.enrichmentComplete) return false;
	if (thought.queueStatus === 'failed') return false;
	return (
		thought.queueStatus === 'pending' ||
		thought.queueStatus === 'processing' ||
		thought.queueStatus === null ||
		thought.queueStatus === undefined
	);
}

/** Wait for background enrichment only while the capture queue is actually in flight. */
async function waitForThoughtIndexed(page: Page, thoughtId: string, raw: string): Promise<void> {
	await expect(page.getByRole('heading', { name: 'Recent' })).toBeVisible({ timeout: RELEASE_WAIT_MS });
	await expect(
		page.getByRole('button', { name: /Expand thought|Collapse thought/ }).first()
	).toContainText(raw.slice(0, 48), { timeout: RELEASE_WAIT_MS });

	await expect
		.poll(
			async () => {
				const thought = await fetchCaptureThoughtResult(page, thoughtId);
				if (!thought) return 'missing';

				if (thought.queueStatus === 'failed') {
					throw new Error(
						`Indexing failed${thought.queueError ? `: ${thought.queueError}` : ''}`
					);
				}
				if (thought.enrichmentComplete) return 'done';

				if (captureIndexingInFlight(thought)) return 'indexing';

				throw new Error(
					`Thought "${raw.slice(0, 40)}…" saved but indexing stopped without completing (queueStatus=${thought.queueStatus ?? 'unknown'})`
				);
			},
			{ timeout: RELEASE_INDEXING_WAIT_MS, intervals: [500, 1000, 2000] }
		)
		.toBe('done');
}

/** Clear drawers/dialogs without blocking on one strategy. Idempotent. */
async function dismissBlockingLayers(page: Page): Promise<void> {
	if (await visible(page.getByTestId('project-delete-confirm'), QUICK_MS)) {
		return;
	}

	const projectDrawer = page.getByRole('button', { name: EDIT_PROJECT_BTN });
	const namedDialog = page.getByRole('dialog').filter({
		has: page.getByRole('button', { name: /Cancel|Abbrechen|Save changes|Änderungen speichern|Create project|Projekt anlegen/ })
	});

	const blocking = async (): Promise<boolean> =>
		(await visible(projectDrawer)) || (await visible(namedDialog));

	if (!(await blocking())) return;

	const attempts: Array<() => Promise<void>> = [
		() => page.keyboard.press('Escape'),
		() => page.keyboard.press('Escape'),
		() =>
			page
				.locator('[data-vaul-overlay], [data-slot="drawer-overlay"]')
				.first()
				.click({ position: { x: 6, y: 6 }, force: true }),
		() => page.getByRole('button', { name: DIALOG_CANCEL_BTN }).first().click(),
		() => page.getByRole('button', { name: /Tasks|Aufgaben/, exact: true }).click(),
		() => page.goto('/memory/timeline', { waitUntil: 'domcontentloaded' }),
		() => page.goto('/capture', { waitUntil: 'domcontentloaded' })
	];

	for (const attempt of attempts) {
		if (!(await blocking())) return;
		await attempt().catch(() => undefined);
	}

	await page.goto('/capture', { waitUntil: 'domcontentloaded' }).catch(() => undefined);
}

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
	{ label: 'LLM_RULE_EMBEDDING', isSet: () => Boolean(process.env.LLM_RULE_EMBEDDING?.trim()) },
	{ label: 'OPENROUTER_BASE_URL', isSet: () => Boolean(process.env.OPENROUTER_BASE_URL?.trim()) },
	{
		label: 'SERVICE_API_KEY_OPENROUTER',
		isSet: () => Boolean(process.env.SERVICE_API_KEY_OPENROUTER?.trim())
	}
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
	{ path: '/settings/llm', label: 'Settings Credits' },
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

function isPayPalDetachedError(err: unknown): boolean {
	const message = err instanceof Error ? err.message : String(err);
	return /detached|Target closed|Execution context was destroyed/i.test(message);
}

function livePayPalContexts(checkoutPage: Page): Array<Page | Frame> {
	if (checkoutPage.isClosed()) {
		return [];
	}
	const contexts: Array<Page | Frame> = [checkoutPage];
	for (const frame of checkoutPage.frames()) {
		if (!frame.isDetached()) {
			contexts.push(frame);
		}
	}
	return contexts;
}

async function scanPayPalContext(ctx: Page | Frame): Promise<boolean> {
	try {
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
		const count = await buttons.count().catch(() => 0);
		for (let i = count - 1; i >= 0; i--) {
			const box = await buttons.nth(i).boundingBox().catch(() => null);
			if (box && box.height >= 36 && box.width >= 80) {
				return true;
			}
		}
	} catch (err) {
		if (isPayPalDetachedError(err)) {
			return false;
		}
		throw err;
	}
	return false;
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

async function paypalCheckoutReady(checkoutPage: Page): Promise<boolean> {
	if (checkoutPage.isClosed()) {
		return false;
	}

	const url = checkoutPage.url();
	if (!url || url === 'about:blank' || !/sandbox\.paypal\.com/i.test(url)) {
		return false;
	}

	for (const ctx of livePayPalContexts(checkoutPage)) {
		if (await scanPayPalContext(ctx)) {
			return true;
		}
	}

	return false;
}

async function waitForPayPalCheckoutReady(checkoutPage: Page): Promise<void> {
	await expect
		.poll(() => paypalCheckoutReady(checkoutPage), {
			timeout: RELEASE_WAIT_MS,
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

async function waitForPayPalOrderApproved(orderId: string, timeoutMs = RELEASE_WAIT_MS): Promise<void> {
	await expect
		.poll(() => getPayPalOrderStatus(orderId), {
			timeout: timeoutMs,
			intervals: [500, 1000, 2000]
		})
		.toMatch(/APPROVED|COMPLETED/i);
}

async function selectPayPalFundingIfNeeded(checkoutPage: Page): Promise<void> {
	for (const ctx of livePayPalContexts(checkoutPage)) {
		try {
			const radio = ctx.locator('input[type="radio"]:visible').first();
			if (await radio.isVisible().catch(() => false)) {
				await radio.check({ force: true }).catch(() => radio.click({ force: true }));
				return;
			}
		} catch (err) {
			if (isPayPalDetachedError(err)) continue;
			throw err;
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
			{ waitUntil: 'domcontentloaded', timeout: RELEASE_WAIT_MS }
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
	const submitVisible = async (): Promise<boolean> => {
		for (const ctx of livePayPalContexts(checkoutPage)) {
			try {
				for (const selector of PAYPAL_SUBMIT_SELECTORS) {
					if (await ctx.locator(selector).first().isVisible().catch(() => false)) {
						return true;
					}
				}
				const buttons = ctx.locator('button:visible:not([disabled])');
				const count = await buttons.count().catch(() => 0);
				for (let i = count - 1; i >= 0; i--) {
					const box = await buttons.nth(i).boundingBox().catch(() => null);
					if (box && box.height >= 36 && box.width >= 120) {
						return true;
					}
				}
			} catch (err) {
				if (isPayPalDetachedError(err)) continue;
				throw err;
			}
		}
		return false;
	};

	await expect
		.poll(submitVisible, { timeout: RELEASE_WAIT_MS, intervals: [250, 500, 1000] })
		.toBe(true);

	for (const ctx of livePayPalContexts(checkoutPage)) {
		try {
			for (const selector of PAYPAL_SUBMIT_SELECTORS) {
				const button = ctx.locator(selector).first();
				if (await isVisible(button, 1_000)) {
					await button.click();
					return;
				}
			}
		} catch (err) {
			if (isPayPalDetachedError(err)) continue;
			throw err;
		}
	}

	for (const ctx of livePayPalContexts(checkoutPage)) {
		try {
			const buttons = ctx.locator('button:visible:not([disabled])');
			const count = await buttons.count().catch(() => 0);
			for (let i = count - 1; i >= 0; i--) {
				const button = buttons.nth(i);
				const box = await button.boundingBox().catch(() => null);
				if (box && box.height >= 36 && box.width >= 120) {
					await button.click();
					return;
				}
			}
		} catch (err) {
			if (isPayPalDetachedError(err)) continue;
			throw err;
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
		}, { timeout: RELEASE_WAIT_MS })
		.toBeGreaterThanOrEqual(50);
}

function onboardingDialog(page: Page): Locator {
	return page.getByRole('dialog', {
		name: /Your memory, not theirs\.|Just drop it in\.|Install Eigen|Stay in the loop/
	});
}

/**
 * Step through the welcome overlay (product → install → notifications), then
 * optionally top up via API (PayPal lives outside onboarding — Settings / capture gate).
 * E2E skips real PWA install / notification permission via the continue-without actions.
 */
export async function completeOnboardingOverlay(
	page: Page,
	options?: { creditAmount?: number }
): Promise<void> {
	const dialog = onboardingDialog(page);
	await expect(dialog).toBeVisible();
	await expect(dialog.getByText('Step 1 of 4')).toBeVisible();
	await expect(dialog.getByText('Your memory, not theirs.')).toBeVisible();

	await dialog.getByRole('button', { name: 'Next' }).click();
	await expect(dialog.getByText('Just drop it in.')).toBeVisible({ timeout: 10_000 });
	await expect(dialog.getByText('Step 2 of 4')).toBeVisible();

	await dialog.getByRole('button', { name: 'Next' }).click();
	await expect(dialog.getByText('Install Eigen')).toBeVisible({ timeout: 10_000 });
	await expect(dialog.getByText('Step 3 of 4')).toBeVisible();
	await dialog.getByRole('button', { name: 'Continue without installing' }).click();

	await expect(dialog.getByText('Stay in the loop')).toBeVisible({ timeout: 10_000 });
	await expect(dialog.getByText('Step 4 of 4')).toBeVisible();
	await dialog.getByRole('button', { name: 'Continue without notifications' }).click();
	await expect(dialog).toBeHidden({ timeout: 15_000 });

	if (options?.creditAmount != null) {
		await topUpCreditsViaPayPalSandbox(page, {
			amountCredits: options.creditAmount
		});
	}
}

export async function captureThoughtViaUi(page: Page, raw: string): Promise<void> {
	await dismissBlockingLayers(page);
	await page.goto('/capture', { waitUntil: 'domcontentloaded' });
	await dismissBlockingLayers(page);

	if (await visible(onboardingDialog(page))) {
		throw new Error('Onboarding overlay still open — complete onboarding before capture');
	}

	await page.locator('#thought').fill(raw);
	const captureBtn = page.getByRole('button', { name: 'Capture', exact: true });

	for (let attempt = 0; attempt < 3; attempt++) {
		if (await captureBtn.isEnabled().catch(() => false)) break;
		await page.waitForTimeout(500);
	}
	if (!(await captureBtn.isEnabled().catch(() => false))) {
		throw new Error('Capture button stayed disabled');
	}

	const errorBanner = page.locator('p.text-destructive.text-sm').first();

	const submitResponsePromise = page.waitForResponse(
		(res) => res.url().includes('/api/capture/submit') && res.request().method() === 'POST',
		{ timeout: RELEASE_WAIT_MS }
	);
	await captureBtn.click();

	const submitRes = await submitResponsePromise;
	const submitBody = await submitRes.text();
	if (!submitRes.ok()) {
		throw new Error(submitBody.trim() || `Capture submit failed (${submitRes.status()})`);
	}

	const thoughtId = parseCaptureSubmitThoughtId(
		submitBody,
		submitRes.headers()['content-type'] ?? ''
	);
	if (!thoughtId) {
		if (await visible(errorBanner, QUICK_MS)) {
			const message = (await errorBanner.textContent())?.trim();
			throw new Error(message ? `Capture failed: ${message}` : 'Capture failed');
		}
		throw new Error('Capture submit succeeded but returned no thought id');
	}

	await waitForThoughtIndexed(page, thoughtId, raw);
}

export async function visitAuthenticatedSurfaces(page: Page): Promise<void> {
	await exerciseAuthenticatedUi(page);
}

type TimelineProjectRow = {
	entityId: string;
	label: string;
	status: string;
	openTaskCount: number;
};

async function fetchTimelineProjects(page: Page): Promise<TimelineProjectRow[]> {
	const body = await page.evaluate(async () => {
		const res = await fetch('/api/timeline/projects?author=user');
		if (!res.ok) return null;
		return (await res.json()) as { projects?: TimelineProjectRow[] };
	});
	if (!body) {
		throw new Error('fetchTimelineProjects failed');
	}
	return body.projects ?? [];
}

async function findProject(page: Page, entityId: string): Promise<TimelineProjectRow | undefined> {
	return (await fetchTimelineProjects(page)).find((p) => p.entityId === entityId);
}

async function gotoTimelineProjectsView(page: Page): Promise<void> {
	await dismissBlockingLayers(page);
	await page.goto('/memory/timeline', { waitUntil: 'domcontentloaded' });

	for (let attempt = 0; attempt < 4; attempt++) {
		const projectsToggle = page.getByRole('button', { name: PROJECTS_TAB });
		if (await visible(projectsToggle)) {
			await projectsToggle.click().catch(() => undefined);
		}
		if (await visible(page.getByRole('button', { name: ADD_PROJECT_BTN }))) {
			return;
		}
		await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
	}
	throw new Error('Timeline projects view did not load');
}

async function createProjectViaUi(page: Page, label: string): Promise<TimelineProjectRow> {
	await gotoTimelineProjectsView(page);
	await page.getByRole('button', { name: ADD_PROJECT_BTN }).click();
	const createDialog = page.getByRole('dialog').filter({ has: page.locator('#create-project-label') });
	if (!(await visible(createDialog, ACTION_MS))) {
		throw new Error('Add project dialog did not open');
	}
	await createDialog.locator('#create-project-label').fill(label);

	const createResponse = page.waitForResponse(
		(res) => res.url().includes('/api/timeline/projects') && res.request().method() === 'POST',
		{ timeout: ACTION_MS }
	);
	await createDialog.getByRole('button', { name: CREATE_PROJECT_SUBMIT }).click();
	const res = await createResponse;
	if (!res.ok()) {
		throw new Error(`create project failed (${res.status()}): ${await res.text()}`);
	}
	await expect(createDialog).toBeHidden({ timeout: QUICK_MS });
	await dismissBlockingLayers(page);

	const created = (await fetchTimelineProjects(page)).find((p) => p.label === label);
	if (!created) {
		throw new Error(`Project "${label}" missing in API immediately after create`);
	}
	return created;
}

async function openProjectDetail(page: Page, projectLabel: string): Promise<void> {
	await gotoTimelineProjectsView(page);
	const listbox = page.getByRole('listbox', { name: PROJECTS_LISTBOX });
	const row = listbox.locator('div').filter({ has: page.getByText(projectLabel, { exact: true }) }).first();
	const openBtn = row.getByRole('button', { name: OPEN_PROJECT_BTN });

	if (await visible(openBtn)) {
		await openBtn.click();
	} else if (await visible(page.getByText(projectLabel, { exact: true }).first())) {
		await page.getByText(projectLabel, { exact: true }).first().click();
	} else {
		throw new Error(`Project "${projectLabel}" not found in list`);
	}

	if (!(await visible(page.getByRole('button', { name: EDIT_PROJECT_BTN }), ACTION_MS))) {
		throw new Error(`Project detail drawer did not open for "${projectLabel}"`);
	}
}

async function renameProjectViaUi(
	page: Page,
	projectName: string,
	renamedProject: string
): Promise<void> {
	await openProjectDetail(page, projectName);
	await page.getByRole('button', { name: EDIT_PROJECT_BTN }).click();

	const editDialog = page.getByRole('dialog').filter({ has: page.locator('#edit-project-label') });
	if (!(await visible(editDialog, ACTION_MS))) {
		throw new Error('Edit project dialog did not open');
	}
	await editDialog.locator('#edit-project-label').fill(renamedProject);

	const updateResponse = page.waitForResponse(
		(res) => /\/api\/timeline\/projects\/[^/]+\/update$/.test(res.url()) && res.request().method() === 'PUT',
		{ timeout: ACTION_MS }
	);
	await editDialog.getByRole('button', { name: SAVE_PROJECT_BTN }).click();
	const res = await updateResponse;
	if (!res.ok()) {
		throw new Error(`project rename failed (${res.status()}): ${await res.text()}`);
	}
	await expect(editDialog).toBeHidden({ timeout: QUICK_MS });
	await dismissBlockingLayers(page);
}

async function confirmProjectDeleteModal(page: Page): Promise<void> {
	const modal = page.getByTestId('project-delete-confirm');
	await expect(modal).toBeVisible({ timeout: ACTION_MS });
	await expect(modal.getByRole('heading', { name: DELETE_PROJECT_CONFIRM_TITLE })).toBeVisible();

	const dismissResponse = page.waitForResponse(
		(res) =>
			/\/api\/timeline\/projects\/[^/]+\/dismiss$/.test(res.url()) &&
			res.request().method() === 'POST',
		{ timeout: ACTION_MS }
	);
	await modal.getByRole('button', { name: DELETE_PROJECT_BTN }).click();

	const res = await dismissResponse;
	if (!res.ok()) {
		throw new Error(`project dismiss failed (${res.status()}): ${await res.text()}`);
	}
	await expect(modal).toBeHidden({ timeout: QUICK_MS });
}

async function dismissProjectViaUi(page: Page, entityId: string, projectLabel: string): Promise<void> {
	await openProjectDetail(page, projectLabel);

	const deleteTrigger = page.getByRole('button', { name: DELETE_PROJECT_BTN }).first();
	if (!(await visible(deleteTrigger, ACTION_MS))) {
		throw new Error(`Delete control not found in project detail for "${projectLabel}"`);
	}

	await deleteTrigger.click();
	await confirmProjectDeleteModal(page);

	if (await findProject(page, entityId)) {
		throw new Error(`Project "${projectLabel}" (${entityId}) still listed after confirm delete`);
	}

	await dismissBlockingLayers(page);
}

/**
 * Manual GTD project lifecycle: create → capture-linked task → rename → dismiss → no resurrection.
 */
export async function exerciseProjectsLifecycle(page: Page): Promise<void> {
	const projectName = 'Release Smoke Project';
	const renamedProject = 'Release Smoke Project Renamed';
	const projectTaskThought =
		'Next action for Release Smoke Project: book venue shortlist for the team offsite';
	const postRenameThought =
		'Update for Release Smoke Project Renamed: send invites after venue is confirmed';
	const postDismissThought =
		'Follow-up for Release Smoke Project Renamed: this should not restore the dismissed project';

	const created = await createProjectViaUi(page, projectName);

	await captureThoughtViaUi(page, projectTaskThought);
	await pollUntil(
		`task linked to "${projectName}"`,
		async () => ((await findProject(page, created.entityId))?.openTaskCount ?? 0) > 0,
		{ timeoutMs: RELEASE_INDEXING_WAIT_MS, intervalMs: 2_000 }
	);

	await renameProjectViaUi(page, projectName, renamedProject);
	const renamedRow = await findProject(page, created.entityId);
	if (renamedRow?.label !== renamedProject) {
		throw new Error(
			`Expected project label "${renamedProject}" after rename, got "${renamedRow?.label ?? 'missing'}"`
		);
	}

	await captureThoughtViaUi(page, postRenameThought);
	await pollUntil(
		`second task on "${renamedProject}"`,
		async () => {
			const row = await findProject(page, created.entityId);
			return row?.label === renamedProject && row.openTaskCount >= 1;
		},
		{ timeoutMs: RELEASE_INDEXING_WAIT_MS, intervalMs: 2_000 }
	);

	await dismissProjectViaUi(page, created.entityId, renamedProject);

	await captureThoughtViaUi(page, postDismissThought);
	if (await findProject(page, created.entityId)) {
		throw new Error('Dismissed project reappeared after follow-up capture');
	}
}

type ScheduledTaskSnapshot = {
	activeRun?: unknown;
	lastRunAt?: string | null;
	lastRunStatus?: string | null;
};

async function fetchScheduledTask(page: Page): Promise<ScheduledTaskSnapshot | null> {
	const res = await page.request.get('/api/scheduled-tasks');
	if (!res.ok()) return null;
	const body = (await res.json()) as { tasks?: ScheduledTaskSnapshot[] };
	return body.tasks?.[0] ?? null;
}

/** Run overnight consolidation from Settings → Heartbeat and wait for completion. */
export async function exerciseOvernightConsolidation(page: Page): Promise<void> {
	await page.goto('/settings/scheduled-tasks');
	await expect(page.getByRole('heading', { name: 'Heartbeat' })).toBeVisible();

	const baseline = await fetchScheduledTask(page);
	const baselineLastRunAt = baseline?.lastRunAt ?? null;

	const runNow = page.getByRole('button', { name: 'Run now' });
	let triggered = false;
	if (await runNow.isVisible().catch(() => false)) {
		// POST returns 202 immediately; drain continues in the background.
		const triggerResponse = page.waitForResponse(
			(res) =>
				res.request().method() === 'POST' &&
				/\/api\/scheduled-tasks\/[^/]+$/.test(res.url()) &&
				(res.status() === 202 || res.status() === 409),
			{ timeout: RELEASE_HEARTBEAT_WAIT_MS }
		);
		await runNow.click();
		const response = await triggerResponse;
		if (!response.ok() && response.status() !== 409) {
			throw new Error(`Heartbeat trigger failed (${response.status()}): ${await response.text()}`);
		}
		triggered = true;
	}

	await expect
		.poll(
			async () => {
				const task = await fetchScheduledTask(page);
				if (!task) return false;
				if (task.activeRun || task.lastRunStatus === 'running') return false;
				if (task.lastRunStatus !== 'completed' || !task.lastRunAt) return false;
				if (triggered) return task.lastRunAt !== baselineLastRunAt;
				return true;
			},
			{ timeout: RELEASE_HEARTBEAT_WAIT_MS, intervals: [1000, 2000, 3000] }
		)
		.toBe(true);

	await expect(page.getByText('Heartbeat finished.')).toBeVisible({ timeout: RELEASE_WAIT_MS });
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
	await exerciseChatFailureUi(page);
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

	for (const item of ['Activity', 'API Keys', 'Credits', 'Heartbeat', 'Settings'] as const) {
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
	// Toggle between Tasks and Projects views
	await page.getByRole('button', { name: /Tasks|Projects/ }).click();
	await page.getByRole('button', { name: /Tasks|Projects/ }).click();
	for (const segment of ['To do', 'Done', 'Overdue'] as const) {
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
	await assertVoiceTranscribeApi(page, { timeoutMs: RELEASE_WAIT_MS });
	await installVoiceCaptureMocks(page);
	await exerciseVoiceCaptureUi(page, { timeoutMs: RELEASE_WAIT_MS });

	await page.goto('/capture');

	const expand = page.getByRole('button', { name: 'Expand thought' }).first();
	if (await expand.isVisible().catch(() => false)) {
		await expand.click();
		await page.getByRole('button', { name: 'Collapse thought' }).first().click();
	}
}

async function exerciseChatUi(page: Page): Promise<void> {
	await startNewChatSession(page);

	const question = 'What city did I mention in my recent capture?';
	await askChatQuestion(page, question);
	await expect(page.getByText(question)).toBeVisible({ timeout: RELEASE_WAIT_MS });

	await assertChatLoadingVisible(page);
	await waitForChatAnswerMarker(page, /Lisbon/i, RELEASE_INDEXING_WAIT_MS);
	await expect(page.getByRole('button', { name: 'Regenerate answer' })).toBeVisible({
		timeout: RELEASE_WAIT_MS
	});

	const logText = (await page.getByRole('log', { name: 'Chat messages' }).textContent()) ?? '';
	assertChatLogHasNoRawJson(logText);
	await expect(page.locator('.animate-spin')).toHaveCount(0);
	await waitForChatIdle(page, RELEASE_WAIT_MS);
}

async function exerciseChatFailureUi(page: Page): Promise<void> {
	await page.route('**/api/chat', async (route) => {
		if (route.request().method() !== 'POST') {
			await route.continue();
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 750));
		await route.fulfill({
			status: 200,
			headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
			body:
				'{"type":"agent_progress","label":"Planning next step…"}\n' +
				'{"type":"error","error":"Chat service unavailable for this test."}\n'
		});
	});

	try {
		await startNewChatSession(page);
		await askChatQuestion(page, 'What did I capture recently?');

		await expect
			.poll(
				async () =>
					(await page.getByText(/Planning next step|Connecting…|Working…/i).first().isVisible().catch(() => false)) ||
					(await page.locator('.animate-spin').first().isVisible().catch(() => false)) ||
					(await page.getByText(/Chat service unavailable for this test/i).isVisible().catch(() => false)),
				{ timeout: RELEASE_WAIT_MS, intervals: [100, 250, 500] }
			)
			.toBe(true);

		await expect(page.getByText(/Chat service unavailable for this test/i)).toBeVisible({
			timeout: RELEASE_WAIT_MS
		});
		await waitForChatIdle(page, RELEASE_WAIT_MS);

		const logText = (await page.getByRole('log', { name: 'Chat messages' }).textContent()) ?? '';
		assertChatLogHasNoRawJson(logText);
		await expect(page.locator('.animate-spin')).toHaveCount(0);
	} finally {
		await page.unroute('**/api/chat');
	}
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
}

async function exerciseApiKeysUi(page: Page): Promise<void> {
	await page.goto('/api-keys');
	await page.getByRole('button', { name: 'Generate new key', exact: true }).click();
	await expect(page.getByRole('dialog')).toBeVisible();
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
