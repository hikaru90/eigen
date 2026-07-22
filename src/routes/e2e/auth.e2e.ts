import { expect, test } from '@playwright/test'
import { assertRedirectsToLogin, loginUser, registerUser, signOut } from './test-helpers'

test.describe('Auth redirects (AC-019)', () => {
  const PROTECTED_ROUTES = ['/capture', '/activity', '/settings', '/settings/llm', '/memory']

  for (const route of PROTECTED_ROUTES) {
    test(`redirects unauthenticated user from ${route} to /login`, async ({ page }) => {
      await assertRedirectsToLogin(page, route)
    })
  }
})

test.describe('Registration and login flow', () => {
  test('new user can register and lands on /capture', async ({ page, context }) => {
    const { email } = await registerUser(context, page)
    await expect(page.locator('text=Capture')).toBeVisible()
    await expect(page.locator(`text=${email}`)).toBeVisible()
  })

  test('registered user can sign in and lands on /capture', async ({ page, context }) => {
    const { email } = await registerUser(context, page)

    await signOut(page)

    await loginUser(page, email)
    await expect(page.locator('text=Capture')).toBeVisible()
  })
})

test.describe('Logout', () => {
  test('signed-out user is redirected to /login on protected pages', async ({ page, context }) => {
    await registerUser(context, page)

    await signOut(page)
    await page.goto('/capture')
    await page.waitForURL(/\/login/)
  })
})
