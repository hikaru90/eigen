import { expect, test } from '@playwright/test';
import {
	assertReleasePreflight,
	captureThoughtViaUi,
	completeOnboardingOverlay,
	exerciseAuthenticatedUi,
	loginUser,
	registerUser
} from './release-helpers';

test.describe('Release smoke @release', () => {
	test.describe.configure({ mode: 'serial', timeout: 600_000 });

	test.beforeAll(() => {
		assertReleasePreflight();
	});

	test('register → onboard → PayPal → capture → exercise UI → re-login', async ({ page, context, baseURL }) => {
		await context.grantPermissions(['microphone'], {
			origin: baseURL ?? 'http://localhost:5173'
		});
		const releaseThought =
			'Release smoke thought: planning a team offsite in Lisbon next quarter';

		let email = '';

		await test.step('create account', async () => {
			({ email } = await registerUser(context, page));
			await expect(page).toHaveURL(/\/capture/);
			await expect(page.getByRole('dialog')).toBeVisible();
			await expect(page.getByText('Welcome to Eigen')).toBeVisible();
		});

		await test.step('complete onboarding and buy sandbox credits', async () => {
			await completeOnboardingOverlay(page, { creditAmount: 1000 });
		});

		await test.step('capture a thought through the UI', async () => {
			await captureThoughtViaUi(page, releaseThought);
			await expect(page.getByRole('heading', { name: 'Recent' })).toBeVisible();
			await expect(page.getByRole('button', { name: 'Collapse thought' })).toContainText('Lisbon');
		});

		await test.step('exercise authenticated surfaces and controls', async () => {
			await exerciseAuthenticatedUi(page);
		});

		await test.step('sign out and sign back in', async () => {
			await page.goto('/api/session/sign-out');
			await loginUser(page, email);
			await expect(page).toHaveURL(/\/capture/);
			await expect(page.getByText(email)).toBeVisible();
		});
	});
});
