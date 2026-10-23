import { expect, test } from '@playwright/test'
import {
  captureThoughtViaUi,
  completeOnboardingOverlay,
  registerUser,
} from './release-helpers'

/**
 * Desk surface: WebGL hub for projects (piles) and loose tasks, with the graph
 * wall behind. Mirrors the seeding recipe of projects-assign-task.e2e.ts:
 * fresh user → onboarding credits → API project → captured thought.
 */

const DESK_PROJECT = 'QA Desk Project'
const DESK_TASK = 'Remember to water the plants on the balcony this week'
const DESK_TASK_TWO = 'Send the signed contract to the notary on Friday'

test.describe('Desk surface @qa', () => {
  test.describe.configure({ mode: 'serial', timeout: 300_000 })

  let projectId: string | null = null

  test('desk renders project pile, task sheet, wall, and navigates from the pile', async ({
    page,
    context,
  }) => {
    await test.step('register and onboard', async () => {
      await registerUser(context, page, { emailDomain: 'example.com' })
      await expect(page).toHaveURL(/\/capture/)
      await completeOnboardingOverlay(page, { creditAmount: 1000 })
    })

    await test.step('create a project via API', async () => {
      const res = await page.request.post('/api/timeline/projects', {
        data: { label: DESK_PROJECT, status: 'active' },
      })
      expect(res.ok()).toBeTruthy()
      const body = (await res.json()) as { entityId: string }
      projectId = body.entityId
    })

    await test.step('capture an unassigned thought', async () => {
      await captureThoughtViaUi(page, DESK_TASK)
    })

    await test.step('legacy /timeline lands on the desk', async () => {
      await page.goto('/timeline')
      await expect(page).toHaveURL(/\/desk/)
    })

    await test.step('desk canvas, pile label, task label, and nav tab render', async () => {
      await page.goto('/desk')
      await expect(page.getByTestId('desk-scene').locator('canvas')).toBeVisible({
        timeout: 20_000,
      })
      // Project pile label (black chip, count suffix).
      await expect(
        page.locator(`[data-desk-kind="project"][data-desk-id="${projectId}"]`),
      ).toBeVisible({ timeout: 20_000 })
      // Loose task sheet label.
      await expect(
        page.locator('[data-desk-kind="task"]').filter({ hasText: /water the plants/i }),
      ).toBeVisible({ timeout: 30_000 })
      // Desk is the active memory-surface tab.
      await expect(page.locator('nav a[href="/desk"]')).toHaveAttribute(
        'aria-current',
        'page',
      )
      // Wall notes render once graph nodes exist (the captured thought is a node).
      await expect(page.locator('[data-desk-kind="note"]').first()).toBeVisible({
        timeout: 30_000,
      })
    })

    await test.step('clicking the pile opens the project detail page', async () => {
      await page
        .locator(`[data-desk-kind="project"][data-desk-id="${projectId}"]`)
        .click()
      await expect(page).toHaveURL(new RegExp('/memory/projects/'))
    })
  })

  test('dragging a loose task onto a pile assigns it', async ({ page }) => {
    await page.goto('/desk')
    const taskLabel = page
      .locator('[data-desk-kind="task"]')
      .filter({ hasText: /water the plants/i })
      .first()
    await expect(taskLabel).toBeVisible({ timeout: 30_000 })
    const pileLabel = page.locator(`[data-desk-kind="project"][data-desk-id="${projectId}"]`)
    await expect(pileLabel).toBeVisible({ timeout: 20_000 })

    const taskBox = await taskLabel.boundingBox()
    const pileBox = await pileLabel.boundingBox()
    expect(taskBox).toBeTruthy()
    expect(pileBox).toBeTruthy()

    await page.mouse.move(taskBox!.x + taskBox!.width / 2, taskBox!.y + taskBox!.height / 2)
    await page.mouse.down()
    await page.mouse.move(
      pileBox!.x + pileBox!.width / 2,
      pileBox!.y + pileBox!.height / 2,
      { steps: 15 },
    )
    await page.mouse.up()

    // The task leaves the loose surface and joins the pile count.
    await expect(taskLabel).toBeHidden({ timeout: 30_000 })
    await expect(pileLabel).toHaveText(new RegExp(`${DESK_PROJECT} · 1`))
  })

  test('right-click task sheet offers mark-done and completes it', async ({ page }) => {
    await test.step('capture a second loose task', async () => {
      await captureThoughtViaUi(page, DESK_TASK_TWO)
    })

    await page.goto('/desk')
    const taskLabel = page
      .locator('[data-desk-kind="task"]')
      .filter({ hasText: /notary on Friday/i })
      .first()
    await expect(taskLabel).toBeVisible({ timeout: 30_000 })

    await test.step('open context menu and mark done', async () => {
      await taskLabel.click({ button: 'right' })
      const markDone = page.getByRole('button', { name: 'Mark done' })
      await expect(markDone).toBeVisible({ timeout: 10_000 })
      await markDone.click()
    })

    await test.step('done task leaves the desk', async () => {
      await expect(taskLabel).toBeHidden({ timeout: 30_000 })
    })
  })
})
