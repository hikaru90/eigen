import { expect, test } from '@playwright/test'
import { completeOnboardingOverlay, registerUser } from './release-helpers'

/** The non-modal header menu remains a clickable toggle while its sheet is open. */
test.describe('You menu toggle @you-menu', () => {
  test('clicking the hamburger again closes the open menu', async ({ page, context }) => {
    await registerUser(context, page, { emailDomain: 'example.com' })
    const betaModal = page.getByTestId('beta-agreement-modal')
    const onboardingDialog = page.getByRole('dialog', { name: /Your memory, not theirs\./ })
    await expect(betaModal.or(onboardingDialog).first()).toBeVisible({ timeout: 20_000 })
    await betaModal.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {})
    if (await betaModal.isVisible().catch(() => false)) {
      await betaModal.getByRole('checkbox').check()
      await betaModal.getByRole('button', { name: /Accept|Akzeptieren/i }).click()
      await expect(betaModal).toBeHidden({ timeout: 10_000 })
    }
    await completeOnboardingOverlay(page)

    const burger = page.locator('.me-btn')
    const menu = page.locator('[data-testid="you-menu"]')

    await expect(burger).toBeVisible()
    await expect(menu).toBeHidden()

    // Open
    await burger.click()
    await expect(menu).toBeVisible()
    await expect(burger).toHaveAttribute('aria-expanded', 'true')

    // A second normal click works without bypassing browser hit testing.
    await burger.click()
    await expect(menu).toBeHidden()
    await expect(burger).toHaveAttribute('aria-expanded', 'false')
  })
})
