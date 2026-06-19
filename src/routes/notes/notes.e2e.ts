import { expect, test } from '@playwright/test';

test('notes route redirects to login when logged out', async ({ page }) => {
	await page.goto('/notes');
	await expect(page).toHaveURL(/\/login/);
});
