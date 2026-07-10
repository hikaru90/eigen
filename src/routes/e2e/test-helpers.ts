import { expect, type Page, type BrowserContext } from '@playwright/test';
import { HARNESS_E2E_PASSWORD } from '$lib/e2e/harness-credentials';

export const TEST_PASSWORD = HARNESS_E2E_PASSWORD;

let userCounter = 0;

export type RegisterUserOptions = {
	/** Defaults to `test.eigen` (harness). Use a production domain to exercise onboarding. */
	emailDomain?: string;
};

/**
 * Register a fresh test user and return their credentials + the context with session cookies.
 */
export async function registerUser(
	context: BrowserContext,
	page: Page,
	options?: RegisterUserOptions
): Promise<{ email: string }> {
	userCounter += 1;
	const id = `${Date.now()}-${userCounter}`;
	const emailDomain = options?.emailDomain ?? 'test.eigen';
	const email = `e2e-${id}@${emailDomain}`;

	await page.goto('/signup');
	await page.getByRole('button', { name: 'Create account' }).waitFor({ state: 'visible' });

	const displayName = `Test User ${id}`;
	const nameInput = page.locator('#name');
	const emailInput = page.locator('#email');
	const passwordInput = page.locator('#password');

	// Fill email/password first, then name last — early fills can be cleared by Svelte hydration.
	await emailInput.fill(email);
	await passwordInput.fill(TEST_PASSWORD);
	await nameInput.fill(displayName);

	await expect(nameInput).toHaveValue(displayName);
	await expect(emailInput).toHaveValue(email);
	await expect(passwordInput).toHaveValue(TEST_PASSWORD);

	await page.getByRole('button', { name: 'Create account' }).click();

	await page.waitForURL(/\/capture/);
	return { email };
}

/**
 * Login an existing user via the login form.
 */
export async function loginUser(page: Page, email: string): Promise<void> {
	await page.goto('/login');
	await page.waitForURL(/\/login/, { timeout: 15_000 });
	await page.locator('#email').fill(email);
	await page.locator('#password').fill(TEST_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/capture/);
}

/**
 * Sign out via the session API (POST — GET does not clear the Better Auth session).
 */
export async function signOut(page: Page): Promise<void> {
	const res = await page.request.post('/api/session/sign-out');
	if (!res.ok()) {
		throw new Error(`sign-out failed (${res.status()}): ${await res.text()}`);
	}
	await page.goto('/login');
	await page.waitForURL(/\/login/, { timeout: 15_000 });
}

/**
 * Capture a thought by submitting to the API (used for seeding test data).
 * Returns the stored thought id.
 */
export async function captureThought(
	page: Page,
	raw: string
): Promise<{ id: string; normalizedText: string; category: string }> {
	const res = await page.request.post('/api/capture/submit', {
		data: { raw },
		headers: { accept: 'application/json' }
	});
	if (!res.ok) {
		const body = await res.text();
		throw new Error(`captureThought failed (${res.status()}): ${body}`);
	}
	const j = (await res.json()) as { thought: { id: string; normalizedText: string; category: string } };
	return j.thought;
}

/**
 * Navigate to a protected route and assert redirect to /login.
 */
export async function assertRedirectsToLogin(page: Page, path: string): Promise<void> {
	await page.goto(path);
	await page.waitForURL(/\/login/);
}
