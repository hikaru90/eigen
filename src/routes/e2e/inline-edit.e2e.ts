import { expect, test, type Page } from '@playwright/test'
import { registerUser } from './test-helpers'

/**
 * Board 3f2796a8 + b6f74d02 (Lena): a thought is changed where it is read. Unfolding a
 * row in Yarn or in a thread shows its words, type and thread as controls in place —
 * no trip to the thought page, no leaving the list. Changing the thread inside a thread
 * takes the thought out of that list.
 */

const RAW = 'Book the rehearsal room for the studio session next week'
const THREAD = `Inline edit ${Date.now()}`

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

function unfold(page: Page, thoughtId: string) {
  const row = page.getByTestId(`thought-${thoughtId}`)
  return { row, toggle: row.locator('button[aria-expanded]').last() }
}

test('change a thought where you read it — Yarn, then inside its thread', async ({ page, context }) => {
  await registerUser(context, page)
  const thoughtId = await captureOne(page)

  // ——— Yarn: unfold, the editor is right there ———
  await page.goto('/mesh/yarn')
  const { row, toggle } = unfold(page, thoughtId)
  await expect(row).toBeVisible({ timeout: 30_000 })
  await toggle.click()
  const editor = row.getByTestId('thought-inline-editor')
  await expect(editor).toBeVisible()
  await expect(editor.getByTestId('thought-inline-words')).toBeVisible()

  // the type: pick any other kind, the row's chip follows, the page stays
  await editor.getByTestId('thought-type').click()
  const options = page.locator('[data-testid^="thought-type-"]')
  const current = (await editor.getByTestId('thought-type').innerText()).trim()
  const other = options.filter({ hasNotText: current }).first()
  const otherLabel = (await other.innerText()).split('\n')[0].trim()
  await other.click()
  await expect(editor.getByTestId('thought-type')).toContainText(otherLabel, { timeout: 15_000 })
  expect(new URL(page.url()).pathname).toBe('/mesh/yarn')

  // the thread: a new one by name, in place
  await editor.getByTestId('thought-thread').click()
  await page.getByRole('textbox', { name: 'New thread' }).fill(THREAD)
  await page.keyboard.press('Enter')
  await expect(editor.getByTestId('thought-thread')).toContainText(THREAD, { timeout: 15_000 })
  expect(new URL(page.url()).pathname).toBe('/mesh/yarn')

  // ——— inside the thread: same editor; leaving the thread takes it off the list ———
  await page.goto('/mesh/threads')
  await page.getByRole('link', { name: new RegExp(THREAD) }).first().click()
  const inThread = unfold(page, thoughtId)
  await expect(inThread.row).toBeVisible({ timeout: 30_000 })
  await inThread.toggle.click()
  const threadEditor = inThread.row.getByTestId('thought-inline-editor')
  await expect(threadEditor).toBeVisible()
  await expect(threadEditor.getByTestId('thought-thread')).toContainText(THREAD)
  // negative probe: nothing in an unfolded thread row leads to another page
  await expect(inThread.row.getByTestId('thought-row-page')).toHaveCount(0)

  await threadEditor.getByTestId('thought-thread').click()
  await page.getByTestId('thought-thread-unassign').click()
  await expect(page.getByTestId(`thought-${thoughtId}`)).toHaveCount(0, { timeout: 15_000 })
})
