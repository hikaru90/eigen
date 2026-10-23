import { expect, test } from '@playwright/test'
import { completeOnboardingOverlay, registerUser } from './release-helpers'

/** The non-modal header menu remains a clickable toggle while its sheet is open. */
test.describe('You menu toggle @you-menu', () => {
  test('clicking the hamburger again closes the open menu', async ({ page, context }) => {
    await registerUser(context, page, { emailDomain: 'example.com' })
    await completeOnboardingOverlay(page)

    const burger = page.getByRole('button', { name: 'Profile · Settings' })
    const menu = page.getByRole('menu', { name: 'Profile · Settings' })

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
