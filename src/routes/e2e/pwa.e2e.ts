import { expect, test } from '@playwright/test';

test.describe('PWA shell', () => {
	test('serves web manifest and registers service worker', async ({ page }) => {
		const manifestRes = await page.request.get('/manifest.webmanifest');
		expect(manifestRes.ok()).toBeTruthy();
		const manifest = (await manifestRes.json()) as { name?: string; icons?: unknown[] };
		expect(manifest.name).toBe('Eigen');
		expect(Array.isArray(manifest.icons)).toBe(true);
		expect((manifest.icons ?? []).length).toBeGreaterThan(0);

		await page.goto('/login');
		await page.waitForFunction(
			async () => {
				if (!('serviceWorker' in navigator)) return false;
				const reg = await navigator.serviceWorker.getRegistration();
				return reg !== undefined;
			},
			undefined,
			{ timeout: 15_000 }
		);
	});
});
