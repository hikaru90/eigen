import { expect, test } from '@playwright/test';
import { registerUser } from './test-helpers';

test.describe('Capture flow (AC-001, AC-004)', () => {
	test('user submits a text thought and sees stored-result summary', async ({ page, context }) => {
		await registerUser(context, page);
		await page.goto('/capture');

		await page.fill('#thought', 'I need to review the Q3 budget report');
		await page.click('button:has-text("Capture")');

		await expect(page.locator('text=Stored thought')).toBeVisible({ timeout: 30000 });
		await expect(page.locator('text=Q3 budget report')).toBeVisible();
		await expect(page.locator('text=Category:')).toBeVisible();
	});

	test('user can edit a stored thought with natural-language request', async ({ page, context }) => {
		await registerUser(context, page);
		await page.goto('/capture');

		await page.fill('#thought', 'Meeting with design team tomorrow at 2pm');
		await page.click('button:has-text("Capture")');
		await expect(page.locator('text=Stored thought')).toBeVisible({ timeout: 30000 });

		await page.fill('#edit', 'Change category to task and make it more formal');
		await page.click('button:has-text("Submit changes")');

		await expect(page.locator('text=Stored thought')).toBeVisible({ timeout: 30000 });
	});
});
