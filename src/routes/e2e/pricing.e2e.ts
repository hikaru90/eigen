import { expect, test } from '@playwright/test'
import { registerUser } from './test-helpers'

test.describe('Pricing transparency (AC-014, AC-015)', () => {
  test('activity log shows credits and duration per call after capture', async ({
    page,
    context,
  }) => {
    await registerUser(context, page)
    await page.goto('/capture')

    await page.fill('#thought', 'Test thought for pricing verification')
    await page.click('button:has-text("Capture")')
    const confirmCard = page.getByTestId('capture-confirmation-card')
    await expect(confirmCard).toBeVisible({ timeout: 30_000 })
    await confirmCard.getByRole('button', { name: /Confirm|Bestätigen/i }).click()
    await expect(page.getByRole('heading', { name: 'Recent' })).toBeVisible({ timeout: 30_000 })

    await page.goto('/activity')

    await expect(page.locator('table')).toBeVisible({ timeout: 10000 })
    const headers = await page.locator('thead th').allTextContents()
    const headerText = headers.join(' ')
    expect(headerText).toContain('Duration')
    expect(headerText).toContain('Credits')
    expect(headerText).not.toContain('Base USD')
    expect(headerText).not.toContain('Total USD')
    expect(headerText).not.toContain('Markup')

    const rowCount = await page.locator('tbody tr').count()
    expect(rowCount).toBeGreaterThanOrEqual(1)
  })

  test('activity page shows totals row with credits', async ({ page, context }) => {
    await registerUser(context, page)
    await page.goto('/capture')

    await page.fill('#thought', 'Another thought for totals check')
    await page.click('button:has-text("Capture")')
    const confirmCard = page.getByTestId('capture-confirmation-card')
    await expect(confirmCard).toBeVisible({ timeout: 30_000 })
    await confirmCard.getByRole('button', { name: /Confirm|Bestätigen/i }).click()
    await expect(page.getByRole('heading', { name: 'Recent' })).toBeVisible({ timeout: 30_000 })

    await page.goto('/activity')

    await expect(page.locator('tfoot')).toBeVisible()
    const totals = await page.locator('tfoot td').allTextContents()
    const totalsText = totals.join(' ')
    expect(totalsText).toContain('Total (this page)')
    expect(totalsText).not.toContain('$')
  })

  test('empty activity state shows placeholder message', async ({ page, context }) => {
    await registerUser(context, page)
    await page.goto('/activity')

    await expect(page.locator('text=No activity logged yet')).toBeVisible()
  })
})
