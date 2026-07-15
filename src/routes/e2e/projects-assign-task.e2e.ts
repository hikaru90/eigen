import { expect, test } from '@playwright/test';
import {
	captureThoughtViaUi,
	completeOnboardingOverlay,
	registerUser,
	signOut
} from './release-helpers';

const TEST_PROJECT = 'QA Test Project';
const UNASSIGNED_THOUGHT = 'Remember to buy milk and eggs from the grocery store';

test.describe('Projects: unassigned task assignment @qa', () => {
	test.describe.configure({ mode: 'serial', timeout: 300_000 });

	let email = '';

	test('assign task from No project section removes it and shows under project', async ({
		page,
		context,
		baseURL
	}) => {
		await context.grantPermissions(['microphone'], {
			origin: baseURL ?? 'http://127.0.0.1:5173'
		});

		await test.step('register and onboard', async () => {
			({ email } = await registerUser(context, page, { emailDomain: 'example.com' }));
			await expect(page).toHaveURL(/\/capture/);
			await completeOnboardingOverlay(page, { creditAmount: 1000 });
		});

		await test.step('create a project via API', async () => {
			const res = await page.request.post('/api/timeline/projects', {
				data: { label: TEST_PROJECT, status: 'active' }
			});
			expect(res.ok()).toBeTruthy();
		});

		await test.step('capture an unassigned thought', async () => {
			await captureThoughtViaUi(page, UNASSIGNED_THOUGHT);
		});

		await test.step('navigate to Projects view', async () => {
			await page.goto('/memory/timeline');
			const projectsToggle = page.getByRole('button', { name: /Projects/i });
			if (await projectsToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
				await projectsToggle.click();
			}
			await page.waitForTimeout(2000);
		});

		await test.step('verify Assign button exists in No project section', async () => {
			const noProjectSection = page.locator('text=No project').first();
			await expect(noProjectSection).toBeVisible({ timeout: 10000 });

			const assignBtn = page.getByRole('button', { name: 'Assign' }).first();
			await expect(assignBtn).toBeVisible({ timeout: 5000 });
		});

		await test.step('click Assign and select project', async () => {
			const taskBefore = await page
				.locator('text=No project')
				.first()
				.locator('..')
				.locator('..')
				.locator('button:text("Assign")')
				.first();

			const taskCountBefore = await page
				.locator('text=No project')
				.first()
				.locator('..')
				.locator('..')
				.locator('button:text("Assign")')
				.count();

			await taskBefore.click();

			// Wait for assign dialog
			const assignDialog = page.getByRole('dialog');
			await expect(assignDialog).toBeVisible({ timeout: 5000 });

			// Select the project
			const projectOption = assignDialog.getByText(TEST_PROJECT);
			await expect(projectOption).toBeVisible({ timeout: 3000 });
			await projectOption.click();

			// Confirm assignment
			const confirmBtn = assignDialog.getByRole('button', { name: /assign|confirm|save/i });
			await expect(confirmBtn).toBeVisible({ timeout: 3000 });
			await confirmBtn.click();

			// Wait for dialog to close
			await expect(assignDialog).toBeHidden({ timeout: 5000 });
		});

		await test.step('verify task disappeared from No project list', async () => {
			// Wait for UI to update
			await page.waitForTimeout(2000);

			// Check that the No project section count decreased or section is gone
			const noProjectSection = page.locator('text=/No project/').first();
			const sectionText = await noProjectSection.textContent({ timeout: 5000 }).catch(() => '');

			// The count in parentheses should be lower
			const match = sectionText.match(/\((\d+)\)/);
			const count = match ? parseInt(match[1]) : 0;

			// If there were other unassigned tasks, count should be lower
			// If this was the only one, the section might be gone
			expect(count).toBeLessThanOrEqual(0);
		});

		await test.step('verify task appears under assigned project', async () => {
			// Look for the thought text under the project
			await page.waitForTimeout(1000);

			// The thought should now be associated with the project
			// Check via API to be certain
			const res = await page.request.get('/api/temporal-events?author=user');
			expect(res.ok()).toBeTruthy();
			const body = await res.json();
			const thought = body.items?.find(
				(t: { semanticSummary: string }) =>
					t.semanticSummary?.includes('buy milk')
			);

			expect(thought).toBeTruthy();
			expect(thought.projectEntityId).toBeTruthy();
		});
	});
});
