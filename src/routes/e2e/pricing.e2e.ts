import { expect, test } from '@playwright/test'
import { registerUser } from './test-helpers'

async function captureViaUi(page: import('@playwright/test').Page, raw: string) {
  await page.fill('#thought', raw)
  const interpretPromise = page.waitForResponse(
    (res) => res.url().includes('/api/capture/interpret') && res.request().method() === 'POST',
    { timeout: 30_000 },
  )
  await page.click('button:has-text("Capture")')
  const interpretRes = await interpretPromise
  const body = (await interpretRes.json()) as { status?: string; queueStatus?: string }
  const status =
    body.status ??
    (body.queueStatus === 'awaiting_confirmation' ? 'awaiting_confirmation' : 'ingested')
  if (status === 'awaiting_confirmation') {
    const confirmModal = page.getByTestId('capture-confirmation-modal')
    await expect(confirmModal).toBeVisible({ timeout: 30_000 })
    await confirmModal.getByRole('button', { name: /Confirm|Bestätigen/i }).click()
  }
}

test.describe('Pricing transparency (AC-014, AC-015)', () => {
  test('activity log shows credits and duration per call after capture', async ({
    page,
    context,
  }) => {
    await registerUser(context, page)
    await page.goto('/capture')

    await captureViaUi(page, 'Test thought for pricing verification')
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

    await captureViaUi(page, 'Another thought for totals check')
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
