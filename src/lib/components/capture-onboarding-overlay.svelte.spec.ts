import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import CaptureOnboardingOverlay from './capture-onboarding-overlay.svelte';

describe('capture-onboarding-overlay.svelte', () => {
	it('is hidden when open is false', async () => {
		render(CaptureOnboardingOverlay, { open: false });
		await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
	});

	it('steps through onboarding flow when open', async () => {
		render(CaptureOnboardingOverlay, { open: true, billingMode: 'byok' });
		await expect.element(page.getByText('Step 1 of 4')).toBeInTheDocument();
		await page.getByRole('button', { name: 'Next' }).click();
		await expect.element(page.getByText('Step 2 of 4')).toBeInTheDocument();
		await page.getByRole('button', { name: 'Back' }).click();
		await expect.element(page.getByText('Step 1 of 4')).toBeInTheDocument();
	});

	it('does not show BYOK credential forms', async () => {
		render(CaptureOnboardingOverlay, { open: true });
		await page.getByRole('button', { name: 'Next' }).click();
		await expect.element(page.getByText('API key')).not.toBeInTheDocument();
	});

	it('does not reset step when wallet credits update after advancing', async () => {
		const { rerender } = render(CaptureOnboardingOverlay, {
			open: true,
			billingMode: 'platform_credits',
			walletAvailableCredits: 0
		});
		await page.getByRole('button', { name: 'Next' }).click();
		await page.getByRole('button', { name: 'Next' }).click();
		await expect.element(page.getByText('Step 3 of 4')).toBeInTheDocument();

		rerender({
			open: true,
			billingMode: 'platform_credits',
			walletAvailableCredits: 500
		});
		await expect.element(page.getByText('Step 3 of 4')).toBeInTheDocument();
	});
});
