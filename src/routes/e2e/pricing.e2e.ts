import { expect, test } from '@playwright/test'
import { registerUser } from './test-helpers'

/**
 * Capture via the up-front reading (ei redesign decision #3): typing fires the debounced
 * POST /api/capture/read (preview, persists nothing); pressing Capture keeps the accepted
 * reading in ONE POST /api/capture/keep — no interpret-on-submit, no confirmation modal.
 */
async function captureViaUi(page: import('@playwright/test').Page, raw: string) {
  // listener first: the debounced read can answer before the fill settles
  const readPromise = page.waitForResponse(
    (res) => res.url().includes('/api/capture/read') && res.request().method() === 'POST',
    { timeout: 30_000 },
  )
  await page.getByTestId('capture-input').fill(raw)
  const readRes = await readPromise
  if (!readRes.ok()) {
    throw new Error((await readRes.text()).trim() || `Capture read failed (${readRes.status()})`)
  }
  await expect(page.getByTestId('capture-reading')).toContainText(/Sounds like|Klingt wie/, {
    timeout: 30_000,
  })

  const keepPromise = page.waitForResponse(
    (res) => res.url().includes('/api/capture/keep') && res.request().method() === 'POST',
    { timeout: 30_000 },
  )
  await page.getByTestId('capture-submit').click()
  const keepRes = await keepPromise
  if (!keepRes.ok()) {
    throw new Error((await keepRes.text()).trim() || `Capture keep failed (${keepRes.status()})`)
  }
  await expect(page.getByTestId('capture-confirmation-modal')).toHaveCount(0)
}

test.describe('Pricing transparency (AC-014, AC-015)', () => {
  test('activity log shows credits and duration per call after capture', async ({
    page,
    context,
  }) => {
    await registerUser(context, page)
    await page.goto('/capture')

    await captureViaUi(page, 'Test thought for pricing verification')
    // the kept thought settles inline (Capture no longer lists recent thoughts)
    await expect(page.getByTestId('capture-settled')).toBeVisible({ timeout: 30_000 })

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
    await expect(page.getByTestId('capture-settled')).toBeVisible({ timeout: 30_000 })

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
