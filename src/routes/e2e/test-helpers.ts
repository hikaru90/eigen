import type { Page, BrowserContext } from '@playwright/test';

export const TEST_PASSWORD = 'TestPass123!';

let userCounter = 0;

/**
 * Register a fresh test user and return their credentials + the context with session cookies.
 */
export async function registerUser(
	context: BrowserContext,
	page: Page
): Promise<{ email: string }> {
	userCounter += 1;
	const id = `${Date.now()}-${userCounter}`;
	const email = `e2e-${id}@test.eigen`;

	await page.goto('/register');
	await page.fill('#name', `Test User ${id}`);
	await page.fill('#email', email);
	await page.fill('#password', TEST_PASSWORD);
	await page.click('button:has-text("Create account")');

	await page.waitForURL(/\/capture/);
	return { email };
}

/**
 * Login an existing user via the login form.
 */
export async function loginUser(page: Page, email: string): Promise<void> {
	await page.goto('/login');
	await page.fill('#email', email);
	await page.fill('#password', TEST_PASSWORD);
	await page.click('button:has-text("Sign in")');
	await page.waitForURL(/\/capture/);
}

/**
 * Sign out via the API endpoint.
 */
export async function signOut(page: Page): Promise<void> {
	await page.goto('/api/session/sign-out');
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
