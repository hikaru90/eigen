import { expect, test } from '@playwright/test';

test('timeline route redirects to login when logged out', async ({ page }) => {
	await page.goto('/timeline');
	await expect(page).toHaveURL(/\/login/);
});
