import { expect, test } from '@playwright/test'
import { assertAskSuggestionFromCapture } from './ask-suggestions-helpers'
import { exerciseMultiplayerBoard } from './board-helpers'
import { assertNavigationAndAskLayout } from './navigation-layout-helpers'
import {
  assertReleasePreflight,
  assertMarkDoneFromProjectsView,
  assertProjectDetailPageViews,
  assertProjectReviewTidyUp,
  assertProjectWaterfallAndAdvance,
  assertTimelineMountFetchBudget,
  assertTimelineSharedFiltersAndDial,
  assertTimelineSsotCountsAndLists,
  assertTimelineTasksSearch,
  assertCheckInDeepLinkShowsPendingQuestion,
  captureThoughtViaUi,
  captureThoughtViaUiAdjustType,
  completeOnboardingOverlay,
  exerciseAuthenticatedUi,
  exerciseNotesShoppingListAppend,
  exerciseOvernightConsolidation,
  exerciseProjectsLifecycle,
  loginUser,
  registerUser,
} from './release-helpers'
import { expectKeptThought, signOut } from './test-helpers'

test.describe('Release smoke @release', () => {
  test.describe.configure({ mode: 'serial', timeout: 600_000 })

  test.beforeAll(() => {
    assertReleasePreflight()
  })

  test('register → onboard → PayPal → capture → exercise UI → re-login', async ({
    page,
    context,
    browser,
    baseURL,
  }) => {
    await context.grantPermissions(['microphone'], {
      origin: baseURL ?? 'http://127.0.0.1:5173',
    })
    const releaseThought = 'Release smoke thought: planning a team offsite in Lisbon next quarter'

    let email = ''

    await test.step('signup legal links point at the marketing website', async () => {
      await page.goto('/signup')
      const terms = page.getByRole('link', { name: /Terms of Service \(AGB\)/i })
      const privacy = page.getByRole('link', { name: /Privacy Policy/i })
      const imprint = page.getByRole('link', { name: /^Imprint$/i })
      await expect(terms).toHaveAttribute('href', /\/terms$/)
      await expect(privacy).toHaveAttribute('href', /\/privacy$/)
      await expect(imprint).toHaveAttribute('href', /\/imprint$/)
      // Legal docs are hosted on the website, not in the app.
      await expect(terms).toHaveAttribute('href', /^https?:\/\//)
      await expect(page.getByRole('checkbox', { name: /Terms of Service|AGB/i })).toBeVisible()
    })

    await test.step('login offers password reset recovery', async () => {
      await page.goto('/login')
      await expect(page.getByRole('link', { name: /Forgot password/i })).toBeVisible()
      await page.getByRole('link', { name: /Forgot password/i }).click()
      await expect(page).toHaveURL(/\/forgot-password/)
      await expect(page.getByRole('button', { name: /Send reset link/i })).toBeVisible()
    })

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

    await test.step('board: A shares, a second user votes, scores persist, forget cleans up', async () => {
      await exerciseMultiplayerBoard(page, browser)
    })

    await test.step('navigation and Ask layout remain usable', async () => {
      await assertNavigationAndAskLayout(page)
    })

    await test.step('check-in deep link shows pending grounding question', async () => {
      await assertCheckInDeepLinkShowsPendingQuestion(page)
    })

    await test.step('capture a thought through the UI (read → keep, no modal)', async () => {
      const id = await captureThoughtViaUi(page, releaseThought)
      // Capture does not show the thought again; it lives on its own page
      await expectKeptThought(page, id, 'Lisbon')
    })

    // Converted from "capture deviation modal: dismiss stores verbatim": the user still
    // overrides the mesh's reading, now up front via the type control before Capture.
    // (The "auto-accept after countdown" scenario is retired — pressing Capture with the
    // shown reading is exactly the default captureThoughtViaUi path above.)
    await test.step('capture: adjust the reading type before Capture (keep carries the pick)', async () => {
      const adjustRaw =
        'Release smoke adjust: keep this meeting in Lisbon next week exactly as written'
      const id = await captureThoughtViaUiAdjustType(page, adjustRaw)
      await expectKeptThought(page, id, /Lisbon|meeting/i)
    })

    await test.step('capture action-item wording through read → keep (no invalid-category fail)', async () => {
      const id = await captureThoughtViaUi(
        page,
        'Release smoke action item: email the Lisbon host about venue deposit',
      )
      await expectKeptThought(page, id, /Lisbon|venue|deposit/i)
    })

    await test.step('Ask suggests a question from an enriched capture; tapping asks it', async () => {
      await assertAskSuggestionFromCapture(page)
    })

    await test.step('timeline cold-mount fetch budget (no duplicate list/stats)', async () => {
      await assertTimelineMountFetchBudget(page)
    })

    await test.step('timeline: shared filters, AI date dial, no kinds', async () => {
      await assertTimelineSharedFiltersAndDial(page)
    })

    await test.step('timeline: Tasks search filters the list', async () => {
      await assertTimelineTasksSearch(page)
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

    await test.step('projects: detail page list/timeline/kanban views', async () => {
      await assertProjectDetailPageViews(page)
    })

    await test.step('projects: tidy-up review dialog confirms before mutating', async () => {
      await assertProjectReviewTidyUp(page)
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
      // the captured thoughts live in the Yarn journal now (Capture lists nothing)
      await page.goto('/mesh/yarn')
      await expect(
        page
          .locator('[data-testid^="thought-"]')
          .filter({ hasText: /Lisbon/i })
          .first(),
      ).toBeVisible()
      // The You menu (header hamburger): opens from its trigger, shows the account,
      // and — the toggle contract — a second click on the same hamburger closes it.
      // While open the registry dropdown is modal (pointer-events: none on the page),
      // so the second physical click lands as an outside-click; locator.click refuses
      // that hit-test, hence the raw mouse click at the trigger's coordinates.
      const youTrigger = page.getByRole('button', { name: /Profile · Settings/ })
      await youTrigger.click()
      await expect(page.getByText(email)).toBeVisible()
      await expect(youTrigger).toHaveAttribute('aria-expanded', 'true')
      const youBox = await youTrigger.boundingBox()
      await page.mouse.click(youBox!.x + youBox!.width / 2, youBox!.y + youBox!.height / 2)
      await expect(page.locator('[data-testid="you-menu"]')).toBeHidden()
      await expect(youTrigger).toHaveAttribute('aria-expanded', 'false')
    })
  })
})

async function registerLayoutUser(
  page: import('@playwright/test').Page,
  context: import('@playwright/test').BrowserContext,
) {
  await registerUser(context, page, { emailDomain: 'example.com' })
  await completeOnboardingOverlay(page)
}

test('navigation and Ask layout regression @layout', async ({ page, context }) => {
  test.setTimeout(120_000)
  await registerLayoutUser(page, context)
  await assertNavigationAndAskLayout(page)
})

test.describe('touch layout regression', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })
  test('navigation and Ask layout on touch @layout', async ({ page, context }) => {
    test.setTimeout(120_000)
    await registerLayoutUser(page, context)
    await assertNavigationAndAskLayout(page, true)
  })
})
