import { expect, test } from '@playwright/test';

test('graph route redirects to login when logged out', async ({ page }) => {
	await page.goto('/graph');
	await expect(page).toHaveURL(/\/login/);
});
