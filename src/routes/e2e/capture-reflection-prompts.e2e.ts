import { expect, test } from '@playwright/test'
import { registerUser } from './test-helpers'

/**
 * Board items 2026-10-28: reflection prompts on Capture
 * (docs/planning/feature-capture-reflection-prompts.md, RP-AC5/6 — the endpoint is stubbed,
 * its generation is unit-tested), the bottom nav answering a tap before the page loads, and
 * the offline line.
 */
const PROMPTS = [
  'How is the offline mode for Eigen going?',
  'Did you call Jonas about the bike trip?',
]

test.describe('Capture reflection prompts, tab switching, offline line @release', () => {
  test('a tapped prompt waits in the field; "Not today" hides them', async ({ page, context }) => {
    await registerUser(context, page)
    const dismissals: string[] = []
    await page.route('**/api/capture/reflection-prompts', async (route) => {
      if (route.request().method() === 'POST') {
        dismissals.push(route.request().url())
        return route.fulfill({ json: { ok: true } })
      }
      return route.fulfill({ json: { state: 'ready', prompts: PROMPTS } })
    })

    await test.step('RP-AC6: tap → the question and a line break in the field, focused', async () => {
      await page.goto('/capture')
      const prompts = page.getByTestId('capture-reflection-prompt')
      await expect(prompts).toHaveText(PROMPTS)
      await prompts.first().click()
      const input = page.getByTestId('capture-input')
      await expect(input).toHaveValue(`${PROMPTS[0]}\n`)
      await expect(input).toBeFocused()
      await expect(page.getByTestId('capture-reflection-prompts')).toHaveCount(0)
    })

    await test.step('RP-AC5: "Not today" hides them and tells the server', async () => {
      await page.getByTestId('capture-input').fill('')
      await page.reload()
      await page.getByTestId('capture-reflection-dismiss').click()
      await expect(page.getByTestId('capture-reflection-prompts')).toHaveCount(0)
      expect(dismissals).toHaveLength(1)
    })
  })

  test('the tapped tab lights before its page has loaded', async ({ page, context }) => {
    await registerUser(context, page)
    await page.goto('/capture')
    await page.waitForLoadState('networkidle')
    // hold the Mesh data back until released, so the only thing that can light the tab is the tap
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    await page.route(/\/mesh\/yarn\/__data\.json/, async (route) => {
      await held
      await route.continue()
    })
    const meshTab = page.locator('nav[aria-label="Main"] a').nth(1)
    await meshTab.click()
    await expect(meshTab).toHaveAttribute('aria-current', 'page', { timeout: 1000 })
    expect(new URL(page.url()).pathname).toBe('/capture')
    release()
    await expect(page).toHaveURL(/\/mesh\/yarn$/, { timeout: 15_000 })
  })

  test('going offline says so, and coming back clears it', async ({ page, context }) => {
    await registerUser(context, page)
    await page.goto('/capture')
    // the app must be up before the connection goes (dev serves its modules on demand)
    await page.waitForLoadState('networkidle')
    await expect(page.getByTestId('offline-notice')).toHaveCount(0)
    await context.setOffline(true)
    await expect(page.getByTestId('offline-notice')).toBeVisible()
    await context.setOffline(false)
    await expect(page.getByTestId('offline-notice')).toHaveCount(0)
  })
})
