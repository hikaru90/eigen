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

	test('user can expand and collapse a recent thought', async ({ page, context }) => {
		await registerUser(context, page);
		await page.goto('/capture');

		const thoughtText = 'Expand toggle test thought about the Berlin museum visit';
		await page.fill('#thought', thoughtText);
		await page.click('button:has-text("Capture")');
		await expect(page.getByText('Category:')).toBeVisible({ timeout: 30_000 });

		await page.getByRole('button', { name: 'Collapse thought' }).first().click();
		await expect(page.getByRole('button', { name: 'Expand thought' }).first()).toBeVisible();

		await page.getByRole('button', { name: 'Expand thought' }).first().click();
		await expect(page.getByText('Category:')).toBeVisible();
		await expect(page.getByText(/Berlin museum visit/i)).toBeVisible();

		await page.getByRole('button', { name: 'Collapse thought' }).first().click();
		await expect(page.getByRole('button', { name: 'Expand thought' }).first()).toBeVisible();
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
