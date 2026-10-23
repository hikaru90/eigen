import { test } from '@playwright/test'
import { exerciseMultiplayerBoard } from './board-helpers'
import { loginUser } from './test-helpers'

/**
 * Multiplayer board, two browser contexts (feature-multiplayer-board.md §9 E2E).
 * User A is the local harness design-review account (it needs credits: sharing
 * runs one billed LLM judge call). Set BOARD_E2E_EMAIL to use another funded
 * account. The release suite runs the same helper with its freshly funded user.
 */
const email = process.env.BOARD_E2E_EMAIL?.trim()

test.describe('Multiplayer board @board', () => {
  test.skip(
    !email,
    'Set BOARD_E2E_EMAIL to a funded local account (e.g. design-review-1@test.eigen)',
  )

  test('A shares, B votes, A sees the score; flip; forget', async ({ page, browser }) => {
    test.setTimeout(240_000)
    await loginUser(page, email!)
    await exerciseMultiplayerBoard(page, browser)
  })
})
