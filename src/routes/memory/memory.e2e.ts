import { expect, test } from '@playwright/test'

test('memory route redirects to login when logged out', async ({ page }) => {
  await page.goto('/memory')
  await expect(page).toHaveURL(/\/login/)
})

test('legacy /graph redirects to login when logged out', async ({ page }) => {
  await page.goto('/graph')
  await expect(page).toHaveURL(/\/login/)
})
