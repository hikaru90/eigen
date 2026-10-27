import { expect, test, type Page, type Response } from '@playwright/test'
import { registerUser } from './test-helpers'

/**
 * Capture feedback C2 (docs/planning/capture-feedback.md §6): the owner can vote 👍 / 👎 on a
 * stored thought in exactly two places — the strip right after Capture, and the unfolded Mesh
 * row (Yarn and threads). Eigen never asks. A 👎 with a reason applies the reason as an edit and
 * the row takes what the server kept; a 👎 with no text stores the verdict only. Nothing is
 * mocked: real keep, real vote endpoint, real edit, real Jev label.
 *
 * Operator-run (needs the local stack and the decision model), headed:
 *   PW_SLOW_MO=300 npx playwright test src/routes/e2e/capture-vote.e2e.ts --headed
 */

const RAW = 'Book the rehearsal room for the studio session next week'
const REASON =
  'The words should read exactly: Rehearsal room booked for Monday at 10am, studio session'

const VOTE_URL = '/api/capture/review/vote'

type VoteAnswer = {
  verdict: string
  reasonKind: string | null
  editApplied: boolean
  editError: string | null
  thought: { normalizedText: string; category: string } | null
}

async function captureOne(page: Page): Promise<string> {
  await page.goto('/capture', { waitUntil: 'networkidle' })
  const input = page.getByTestId('capture-input')
  // early fills can be cleared by hydration (as on /signup): fill until the words stay
  await expect(async () => {
    await input.fill(RAW)
    await expect(input).toHaveValue(RAW, { timeout: 1000 })
  }).toPass({ timeout: 15_000 })
  await page.waitForResponse(
    (res) => res.url().includes('/api/capture/read') && res.request().method() === 'POST',
    { timeout: 30_000 },
  )
  await expect(page.getByTestId('capture-reading')).toContainText('Sounds like')
  const keep = page.waitForResponse(
    (res) => res.url().includes('/api/capture/keep') && res.request().method() === 'POST',
    { timeout: 30_000 },
  )
  await page.getByTestId('capture-submit').click()
  const res = await keep
  expect(res.ok()).toBe(true)
  return ((await res.json()) as { thoughtId: string }).thoughtId
}

function voteResponse(page: Page): Promise<Response> {
  return page.waitForResponse(
    (res) => res.url().includes(VOTE_URL) && res.request().method() === 'POST',
    { timeout: 90_000 },
  )
}

test('vote on a stored thought: 👍 in the strip, the same 👍 on the Yarn row, then a 👎 with a reason edits the row', async ({
  page,
  context,
}) => {
  test.setTimeout(240_000)
  await registerUser(context, page)
  const thoughtId = await captureOne(page)

  // ——— right after Capture: the strip carries the pair, with no question or prompt ———
  const strip = page.getByTestId('capture-kept-strip')
  await expect(strip).toBeVisible({ timeout: 30_000 })
  const stripVote = strip.getByTestId('capture-vote')
  await expect(stripVote).toBeVisible()
  expect((await stripVote.innerText()).trim()).toBe('')
  const stripUp = stripVote.getByRole('button', { name: 'Stored right' })
  await expect(stripUp).toHaveAttribute('aria-pressed', 'false')

  const upSent = voteResponse(page)
  await stripUp.click()
  const upAnswer = (await (await upSent).json()) as VoteAnswer
  expect(upAnswer).toMatchObject({ verdict: 'up', editApplied: false, reasonKind: null })
  await expect(stripUp).toHaveAttribute('aria-pressed', 'true')

  // ——— Yarn: the unfolded row shows the stored 👍 ———
  await page.goto('/mesh/yarn')
  const row = page.getByTestId(`thought-${thoughtId}`)
  await expect(row).toBeVisible({ timeout: 30_000 })
  await row.locator('button[aria-expanded]').last().click()
  const vote = row.getByTestId('capture-vote')
  await expect(vote).toBeVisible()
  await expect(vote.getByRole('button', { name: 'Stored right' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(vote.getByRole('button', { name: 'Stored wrong' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )

  // ——— 👎 with a reason: it is applied as an edit and the row shows what the server kept ———
  const before = (await row.getByTestId('thought-row-text').innerText()).trim()
  await vote.getByRole('button', { name: 'Stored wrong' }).click()
  const field = vote.getByTestId('capture-vote-field')
  await expect(field).toHaveAttribute('placeholder', 'What was wrong?')
  await field.fill(REASON)
  const downSent = voteResponse(page)
  await vote.getByTestId('capture-vote-send').click()
  const downAnswer = (await (await downSent).json()) as VoteAnswer
  expect(downAnswer.verdict).toBe('down')
  expect(downAnswer.editError).toBeNull()
  expect(downAnswer.editApplied).toBe(true)
  expect(downAnswer.reasonKind).not.toBeNull()
  expect(downAnswer.thought).not.toBeNull()
  await expect(row.getByTestId('thought-row-text')).toHaveText(downAnswer.thought!.normalizedText, {
    timeout: 15_000,
  })
  expect(downAnswer.thought!.normalizedText.trim()).not.toBe(before)
  await expect(row.getByTestId('thought-row-text')).toContainText(/Monday/)
  await expect(vote.getByRole('button', { name: 'Stored wrong' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(row.getByRole('alert')).toHaveCount(0)

  // ——— the vote persists: a fresh load of Yarn shows the 👎 (the loader carries the verdict only) ———
  await page.reload()
  const reloaded = page.getByTestId(`thought-${thoughtId}`)
  await expect(reloaded).toBeVisible({ timeout: 30_000 })
  await reloaded.locator('button[aria-expanded]').last().click()
  await expect(
    reloaded.getByTestId('capture-vote').getByRole('button', { name: 'Stored wrong' }),
  ).toHaveAttribute('aria-pressed', 'true')

  // ——— re-voting replaces the vote; a 👎 with an empty box stores the verdict only ———
  const again = reloaded.getByTestId('capture-vote')
  await again.getByRole('button', { name: 'Stored wrong' }).click()
  const emptySent = voteResponse(page)
  await again.getByTestId('capture-vote-send').click()
  const emptyAnswer = (await (await emptySent).json()) as VoteAnswer
  expect(emptyAnswer).toMatchObject({
    verdict: 'down',
    reasonKind: null,
    editApplied: false,
    thought: null,
  })

  // ——— negative probe: a verdict that is neither up nor down fails loudly at the boundary ———
  const bad = await page.request.post(VOTE_URL, {
    data: { thoughtId, verdict: 'maybe', place: 'mesh' },
  })
  expect(bad.status()).toBe(400)
  expect(((await bad.json()) as { message: string }).message).toBe('verdict must be up or down')
})
