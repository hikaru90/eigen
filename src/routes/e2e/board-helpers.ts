import { expect, type Browser, type Locator, type Page } from '@playwright/test'
import { registerUser } from './test-helpers'

/**
 * Multiplayer board (docs/planning/feature-multiplayer-board.md) in two browser
 * contexts: A shares through the composer (LLM judge → idea, A's +1 set), B sees
 * it with A's display name, votes up (A reloads and sees the score), flips down
 * (score drops by 2), then A forgets it and it is gone for B. A must have credits
 * (the share runs one billed judge call); B only votes, which costs nothing.
 */
export async function exerciseMultiplayerBoard(pageA: Page, browser: Browser): Promise<void> {
  const title = `Dark mode for Mesh, please (${Date.now().toString(36)})`

  await pageA.goto('/feedback')
  const composer = pageA.getByRole('textbox', { name: 'What could be better?' })
  await expect(composer).toBeVisible()
  await composer.fill(title)
  await composer.press('Enter')

  // The judge may still name an older dark-mode idea as the same request; the
  // composer then offers "Vote for it instead" / "Mine's different" (AC-12).
  const different = pageA.getByRole('button', { name: 'Mine’s different' })
  const rowA = pageA.locator('article[data-testid^="idea-"]').filter({ hasText: title })
  await expect(rowA.or(different).first()).toBeVisible({ timeout: 90_000 })
  if (await different.isVisible()) {
    await different.click()
  }
  await expect(rowA).toBeVisible({ timeout: 90_000 })
  // AC-14: score 1 with the author's upvote already set
  await expect(score(rowA)).toHaveText('1')
  await expect(upButton(rowA)).toHaveAttribute('aria-pressed', 'true')
  const testId = await rowA.getAttribute('data-testid')
  expect(testId).toMatch(/^idea-[0-9a-f-]{36}$/)

  const contextB = await browser.newContext()
  try {
    const pageB = await contextB.newPage()
    await registerUser(contextB, pageB)
    await pageB.goto('/feedback')
    const rowB = pageB.getByTestId(testId!)
    // AC-1: B sees it as Requested with A's display name — never an email
    await expect(rowB).toBeVisible({ timeout: 30_000 })
    await expect(rowB).toContainText('Requested')
    await expect(rowB).not.toContainText('@')
    await expect(score(rowB)).toHaveText('1')

    // AC-2: B upvotes → A reloads and sees 2; B's arrow stays filled after reload
    await upButton(rowB).click()
    await expect(score(rowB)).toHaveText('2')
    await pageB.reload()
    await expect(upButton(pageB.getByTestId(testId!))).toHaveAttribute('aria-pressed', 'true')
    await pageA.reload()
    await expect(score(pageA.getByTestId(testId!))).toHaveText('2')

    // AC-3: B taps down → score drops by 2, B's vote is −1
    await downButton(pageB.getByTestId(testId!)).click()
    await expect(score(pageB.getByTestId(testId!))).toHaveText('0')
    await expect(downButton(pageB.getByTestId(testId!))).toHaveAttribute('aria-pressed', 'true')

    // AC-4: tapping the current direction again removes the vote
    await downButton(pageB.getByTestId(testId!)).click()
    await expect(score(pageB.getByTestId(testId!))).toHaveText('1')
    await expect(downButton(pageB.getByTestId(testId!))).toHaveAttribute('aria-pressed', 'false')

    // B cannot forget A's idea (no control) — AC-8: A forgets it, gone for everyone
    await expect(
      pageB.getByTestId(testId!).getByRole('button', { name: 'Forget this idea' }),
    ).toHaveCount(0)
    await pageA.getByTestId(testId!).getByRole('button', { name: 'Forget this idea' }).click()
    await expect(pageA.getByTestId(testId!)).toHaveCount(0)
    await pageB.reload()
    await expect(
      pageB
        .locator('article[data-testid^="idea-"]')
        .first()
        .or(pageB.getByText(/Requested/).first()),
    ).toBeVisible()
    await expect(pageB.getByTestId(testId!)).toHaveCount(0)
  } finally {
    await contextB.close()
  }
}

function score(row: Locator): Locator {
  return row.locator('.v-n')
}
function upButton(row: Locator): Locator {
  return row.getByRole('button', { name: /Vote up|Take your vote back/ }).first()
}
function downButton(row: Locator): Locator {
  return row.getByRole('button', { name: /Vote down|Take your vote back/ }).last()
}
