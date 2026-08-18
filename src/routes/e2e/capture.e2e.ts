import { expect, test } from '@playwright/test'
import { registerUser } from './test-helpers'

async function captureAndConfirm(page: import('@playwright/test').Page, raw: string) {
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

test.describe('Capture flow (AC-001, AC-004)', () => {
  test('shows interpreting indicator immediately after Capture, before ingest', async ({
    page,
    context,
  }) => {
    await registerUser(context, page)
    await page.goto('/capture')

    let releaseInterpret: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      releaseInterpret = resolve
    })
    await page.route('**/api/capture/interpret', async (route) => {
      await held
      await route.continue()
    })

    await page.fill('#thought', 'Immediate feedback thought about the Hamburg workshop')
    await page.click('button:has-text("Capture")')

    const pending = page.getByTestId('capture-interpret-pending')
    try {
      await expect(pending).toBeVisible()
      await expect(pending).toContainText('Interpreting')
      await expect(pending).toContainText('Hamburg workshop')
    } finally {
      releaseInterpret()
    }
  })

  test('user submits a text thought, confirms preview, and sees stored-result summary', async ({
    page,
    context,
  }) => {
    await registerUser(context, page)
    await page.goto('/capture')

    await captureAndConfirm(page, 'I need to review the Q3 budget report')

    await expect(page.getByRole('heading', { name: 'Recent' })).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('text=Q3 budget report')).toBeVisible()
    await expect(page.locator('text=Category:')).toBeVisible()
  })

  test('user can expand and collapse a recent thought', async ({ page, context }) => {
    await registerUser(context, page)
    await page.goto('/capture')

    const thoughtText = 'Expand toggle test thought about the Berlin museum visit'
    await captureAndConfirm(page, thoughtText)
    await expect(page.getByText('Category:')).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: 'Collapse thought' }).first().click()
    await expect(page.getByRole('button', { name: 'Expand thought' }).first()).toBeVisible()

    await page.getByRole('button', { name: 'Expand thought' }).first().click()
    await expect(page.getByText('Category:')).toBeVisible()
    await expect(page.getByText(/Berlin museum visit/i)).toBeVisible()

    await page.getByRole('button', { name: 'Collapse thought' }).first().click()
    await expect(page.getByRole('button', { name: 'Expand thought' }).first()).toBeVisible()
  })

  test('user can edit a stored thought with natural-language request', async ({
    page,
    context,
  }) => {
    await registerUser(context, page)
    await page.goto('/capture')

    await captureAndConfirm(page, 'Meeting with design team tomorrow at 2pm')
    await expect(page.getByText('Category:')).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: /Expand thought|Collapse thought/ }).first().click()
    await page.getByRole('button', { name: 'Edit' }).first().click()

    const editArea = page.locator('textarea[id^="edit-"]').first()
    await expect(editArea).toBeVisible({ timeout: 10_000 })
    await editArea.fill('Change category to task and make it more formal')
    await page.click('button:has-text("Submit changes")')

    await expect(page.getByText('Category:')).toBeVisible({ timeout: 30_000 })
  })
})
