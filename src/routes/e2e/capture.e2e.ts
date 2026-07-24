import { expect, test } from '@playwright/test'
import { registerUser } from './test-helpers'

async function captureAndConfirm(page: import('@playwright/test').Page, raw: string) {
  await page.fill('#thought', raw)
  await page.click('button:has-text("Capture")')
  const confirmCard = page.getByTestId('capture-confirmation-card')
  await expect(confirmCard).toBeVisible({ timeout: 30_000 })
  await confirmCard.getByRole('button', { name: /Confirm|Bestätigen/i }).click()
}

test.describe('Capture flow (AC-001, AC-004)', () => {
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
