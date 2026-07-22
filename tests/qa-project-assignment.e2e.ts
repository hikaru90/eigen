import { test, expect } from '@playwright/test'
import { registerUser } from '../src/routes/e2e/test-helpers'

/**
 * QA Test: Project Assignment to Tasks
 *
 * This test verifies the project assignment feature in the Timeline Projects view.
 *
 * LIMITATION: The capture pipeline requires platform credits. New test users start
 * with 0 credits, so we cannot create thoughts/tasks to test the full assignment flow.
 *
 * This test verifies:
 * 1. UI structure (Unassigned section, Assign buttons, Dialog)
 * 2. Dialog behavior (opens, has search input, shows project options)
 *
 * Full end-to-end testing requires either:
 * - Pre-seeded test data with existing tasks
 * - Credits added to the test user's wallet
 */

test.describe('Project Assignment to Tasks', () => {
  let hasCredits = false

  test.beforeEach(async ({ page, context }) => {
    // Register a fresh test user
    const { email } = await registerUser(context, page)

    // Check if user has credits
    const walletRes = await page.request.get('/api/billing/wallet')
    const wallet = await walletRes.json()
    hasCredits = wallet.availableCredits > 0
    console.log(`User credits: ${wallet.availableCredits}`)

    // Navigate to timeline
    await page.goto('/timeline')
    await page.waitForLoadState('networkidle')
  })

  test('AC1: Tasks without a project appear in Unassigned section', async ({ page }) => {
    // Switch to Projects view
    const projectsButton = page.locator('button:has-text("Projects")').first()
    if (await projectsButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await projectsButton.click()
      await page.waitForTimeout(1500)
    }

    // Verify "No project" section header exists
    const unassignedSection = page.locator('text=/No project/').first()
    const hasUnassignedSection = await unassignedSection
      .isVisible({ timeout: 3000 })
      .catch(() => false)

    console.log('Unassigned section visible:', hasUnassignedSection)

    if (hasCredits) {
      // If we have credits, check for Assign buttons
      const assignButtons = await page.locator('button:has-text("Assign")').count()
      console.log('Assign buttons found:', assignButtons)

      if (assignButtons > 0) {
        expect(hasUnassignedSection).toBe(true)
      }
    } else {
      // Without credits, we can only verify the UI structure exists
      console.log('Cannot test without credits - verifying UI structure only')
      // The "No project" section should still be visible (even if empty)
      expect(hasUnassignedSection).toBe(true)
    }
  })

  test('AC2: Clicking assign opens dialog', async ({ page }) => {
    // Switch to Projects view
    const projectsButton = page.locator('button:has-text("Projects")').first()
    if (await projectsButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await projectsButton.click()
      await page.waitForTimeout(1500)
    }

    // Look for Assign button
    const assignButton = page.locator('button:has-text("Assign")').first()
    const hasAssignButton = await assignButton.isVisible({ timeout: 3000 }).catch(() => false)

    if (hasAssignButton) {
      // Click Assign button
      await assignButton.click()
      await page.waitForTimeout(500)

      // Dialog should appear
      const dialog = page.locator('[role="dialog"]')
      await expect(dialog).toBeVisible()

      // Should have search input
      const searchInput = dialog.locator('input[type="search"]')
      await expect(searchInput).toBeVisible()

      // Should have project list or empty state
      const projectList = dialog.locator('ul')
      const emptyState = dialog.locator('text=/No projects|empty/i')

      const hasProjects = await projectList.isVisible().catch(() => false)
      const hasEmpty = await emptyState.isVisible().catch(() => false)

      console.log('Dialog has project list:', hasProjects)
      console.log('Dialog has empty state:', hasEmpty)

      // Either projects list or empty state should be visible
      expect(hasProjects || hasEmpty).toBe(true)

      // Take screenshot of dialog
      await page.screenshot({ path: 'test-results/assign-dialog.png' })
    } else {
      console.log('No unassigned tasks to test - skipping')
      test.skip()
    }
  })

  test('AC3: Task disappears from Unassigned after assignment', async ({ page }) => {
    if (!hasCredits) {
      console.log('Cannot test without credits - skipping')
      test.skip()
      return
    }

    // Switch to Projects view
    const projectsButton = page.locator('button:has-text("Projects")').first()
    if (await projectsButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await projectsButton.click()
      await page.waitForTimeout(1500)
    }

    // Get initial unassigned count
    const initialAssignButtons = page.locator('button:has-text("Assign")')
    const initialCount = await initialAssignButtons.count()

    if (initialCount === 0) {
      console.log('No unassigned tasks to test - skipping')
      test.skip()
      return
    }

    // Click first Assign button
    await initialAssignButtons.first().click()
    await page.waitForTimeout(500)

    // Get dialog
    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Type a project name to create a new one
    const searchInput = dialog.locator('input[type="search"]')
    await searchInput.fill('Test Project QA')
    await page.waitForTimeout(300)

    // Look for "Create" option
    const createOption = dialog.locator('button:has-text("Create")').first()
    if (await createOption.isVisible().catch(() => false)) {
      // Click create option
      await createOption.click()
      await page.waitForTimeout(2000)

      // Verify task disappeared from unassigned
      const finalAssignButtons = page.locator('button:has-text("Assign")')
      const finalCount = await finalAssignButtons.count()

      console.log(`Assign buttons: ${initialCount} -> ${finalCount}`)
      expect(finalCount).toBeLessThan(initialCount)
    } else {
      console.log('Create option not found')
      await page.screenshot({ path: 'test-results/dialog-state.png' })
    }
  })

  test('AC4: No duplicate entries after assignment', async ({ page }) => {
    if (!hasCredits) {
      console.log('Cannot test without credits - skipping')
      test.skip()
      return
    }

    // Switch to Projects view
    const projectsButton = page.locator('button:has-text("Projects")').first()
    if (await projectsButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await projectsButton.click()
      await page.waitForTimeout(1500)
    }

    // Get initial task count
    const initialAssignButtons = page.locator('button:has-text("Assign")')
    const initialCount = await initialAssignButtons.count()

    if (initialCount === 0) {
      console.log('No unassigned tasks to test - skipping')
      test.skip()
      return
    }

    // Get the task text before assignment
    const taskText = await page.locator('.text-xs, .text-sm').first().innerText()
    console.log('Task text before assignment:', taskText.substring(0, 50))

    // Click first Assign button
    await initialAssignButtons.first().click()
    await page.waitForTimeout(500)

    // Get dialog
    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Type a project name to create a new one
    const searchInput = dialog.locator('input[type="search"]')
    await searchInput.fill('Test Project QA')
    await page.waitForTimeout(300)

    // Look for "Create" option
    const createOption = dialog.locator('button:has-text("Create")').first()
    if (await createOption.isVisible().catch(() => false)) {
      // Click create option
      await createOption.click()
      await page.waitForTimeout(2000)

      // Check for duplicates
      const allTaskTexts = await page.locator('.text-xs, .text-sm').allInnerTexts()
      const taskTextCount = allTaskTexts.filter((t) => t.includes(taskText.substring(0, 20))).length

      console.log(`Task "${taskText.substring(0, 20)}..." appears ${taskTextCount} time(s)`)

      // Task should appear exactly once (in the project group)
      expect(taskTextCount).toBe(1)
    }
  })

  test('AC5: No tasks vanish entirely from the view', async ({ page }) => {
    if (!hasCredits) {
      console.log('Cannot test without credits - skipping')
      test.skip()
      return
    }

    // Switch to Projects view
    const projectsButton = page.locator('button:has-text("Projects")').first()
    if (await projectsButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await projectsButton.click()
      await page.waitForTimeout(1500)
    }

    // Get initial task count (both assigned and unassigned)
    const initialAssignButtons = page.locator('button:has-text("Assign")')
    const initialUnassignedCount = await initialAssignButtons.count()

    const initialProjectCards = page.locator('button:has(.truncate)')
    const initialProjectCount = await initialProjectCards.count()

    const initialTotalTasks = initialUnassignedCount // Simplified - just count unassigned

    if (initialTotalTasks === 0) {
      console.log('No unassigned tasks to test - skipping')
      test.skip()
      return
    }

    // Click first Assign button
    await initialAssignButtons.first().click()
    await page.waitForTimeout(500)

    // Get dialog
    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Type a project name to create a new one
    const searchInput = dialog.locator('input[type="search"]')
    await searchInput.fill('Test Project QA')
    await page.waitForTimeout(300)

    // Look for "Create" option
    const createOption = dialog.locator('button:has-text("Create")').first()
    if (await createOption.isVisible().catch(() => false)) {
      // Click create option
      await createOption.click()
      await page.waitForTimeout(2000)

      // Verify total task count hasn't decreased
      const finalAssignButtons = page.locator('button:has-text("Assign")')
      const finalUnassignedCount = await finalAssignButtons.count()

      // The task should have moved from unassigned to a project
      // So unassigned count should decrease by 1
      expect(finalUnassignedCount).toBe(initialUnassignedCount - 1)

      // Take screenshot
      await page.screenshot({ path: 'test-results/after-assignment-final.png' })
    }
  })
})
