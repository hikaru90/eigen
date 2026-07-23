import { expect, test } from '@playwright/test'
import {
  assertReleasePreflight,
  assertMarkDoneFromProjectsView,
  assertProjectWaterfallAndAdvance,
  assertTimelineMountFetchBudget,
  assertTimelineSharedFiltersAndDial,
  assertTimelineSsotCountsAndLists,
  assertCheckInDeepLinkShowsPendingQuestion,
  captureThoughtViaUi,
  completeOnboardingOverlay,
  exerciseAuthenticatedUi,
  exerciseNotesShoppingListAppend,
  exerciseOvernightConsolidation,
  exerciseProjectsLifecycle,
  loginUser,
  registerUser,
} from './release-helpers'
import { signOut } from './test-helpers'

test.describe('Release smoke @release', () => {
  test.describe.configure({ mode: 'serial', timeout: 600_000 })

  test.beforeAll(() => {
    assertReleasePreflight()
  })

  test('register → onboard → PayPal → capture → exercise UI → re-login', async ({
    page,
    context,
    baseURL,
  }) => {
    await context.grantPermissions(['microphone'], {
      origin: baseURL ?? 'http://127.0.0.1:5173',
    })
    const releaseThought = 'Release smoke thought: planning a team offsite in Lisbon next quarter'

    let email = ''

    await test.step('create account', async () => {
      ;({ email } = await registerUser(context, page, { emailDomain: 'example.com' }))
      await expect(page).toHaveURL(/\/capture/)
      await expect(page.getByRole('dialog', { name: /Your memory, not theirs\./ })).toBeVisible({
        timeout: 30_000,
      })
    })

    await test.step('complete onboarding and buy sandbox credits', async () => {
      await completeOnboardingOverlay(page, { creditAmount: 1000 })
    })

    await test.step('check-in deep link shows pending grounding question', async () => {
      await assertCheckInDeepLinkShowsPendingQuestion(page)
    })

    await test.step('capture a thought through the UI', async () => {
      await captureThoughtViaUi(page, releaseThought)
      await expect(page.getByRole('heading', { name: 'Recent' })).toBeVisible()
      await expect(
        page.getByRole('button', { name: /Expand thought|Collapse thought/ }).first(),
      ).toContainText('Lisbon')
    })

    await test.step('timeline cold-mount fetch budget (no duplicate list/stats)', async () => {
      await assertTimelineMountFetchBudget(page)
    })

    await test.step('timeline: shared filters, AI date dial, no kinds', async () => {
      await assertTimelineSharedFiltersAndDial(page)
    })

    await test.step('timeline: SSOT counts match lists; projects board has no catalog-only fetch', async () => {
      await assertTimelineSsotCountsAndLists(page)
    })

    await test.step('projects: mark-done uses shared timeline quick action', async () => {
      await assertMarkDoneFromProjectsView(page)
    })

    await test.step('projects: waterfall, milestones, advance next-action', async () => {
      await assertProjectWaterfallAndAdvance(page)
    })

    await test.step('projects: create, capture, edit, dismiss', async () => {
      await exerciseProjectsLifecycle(page)
    })

    await test.step('overnight consolidation heartbeat', async () => {
      await exerciseOvernightConsolidation(page)
    })

    await test.step('notes: create shopping list then append via chat', async () => {
      await exerciseNotesShoppingListAppend(page)
    })

    await test.step('exercise authenticated surfaces and controls', async () => {
      await exerciseAuthenticatedUi(page)
    })

    await test.step('sign out and sign back in', async () => {
      await signOut(page)
      await loginUser(page, email)
      await expect(page).toHaveURL(/\/capture/)
      await expect(page.getByText(/Lisbon/i)).toBeVisible()
      await page.getByRole('button', { name: 'Account menu' }).click()
      await expect(page.getByText(email)).toBeVisible()
    })
  })
})
