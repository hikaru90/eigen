import { expect, type Page } from '@playwright/test'

/**
 * Suggested questions on Ask (docs/planning/feature-ask-suggested-questions.md):
 * capture through the UI → wait for real enrichment → Ask at rest shows a question
 * pill (the stored enrichment question, never the raw thought text) under the heading
 * → tapping it starts the conversation with exactly that question.
 */
export async function assertAskSuggestionFromCapture(page: Page): Promise<void> {
  const raw = 'Call the plumber about the leaking kitchen sink before Friday'

  // Capture through the UI: type, let the read pass answer, press Capture.
  await page.goto('/capture')
  // type only once the page is hydrated — an early fill is reset by Svelte
  await page.waitForLoadState('networkidle')
  const field = page.getByTestId('capture-input')
  await field.click()
  const read = page.waitForResponse(
    (res) => res.url().includes('/api/capture/read') && res.request().method() === 'POST',
    { timeout: 60_000 },
  )
  await field.pressSequentially(raw)
  await expect(field).toHaveValue(raw)
  expect((await read).ok(), 'capture read pass').toBe(true)
  const kept = page.waitForResponse(
    (res) => res.url().includes('/api/capture/keep') && res.request().method() === 'POST',
    { timeout: 60_000 },
  )
  await page.getByTestId('capture-submit').click()
  expect((await kept).ok(), 'capture keep').toBe(true)

  // Enrichment runs in the dev worker; Ask lists the question once it is stored.
  const pills = page.getByTestId('ask-suggestion')
  await expect
    .poll(
      async () => {
        await page.goto('/chat')
        await expect(page.getByTestId('ask-heading')).toBeVisible()
        return pills.count()
      },
      { timeout: 180_000, intervals: [3_000, 5_000, 10_000] },
    )
    .toBeGreaterThan(0)
  const count = await pills.count()
  expect(count).toBeGreaterThan(0)
  expect(count).toBeLessThanOrEqual(3)

  // The pill sits under the heading.
  const headingBox = await page.getByTestId('ask-heading').boundingBox()
  const pillBox = await pills.first().boundingBox()
  expect(headingBox && pillBox && pillBox.y > headingBox.y).toBe(true)

  const question = ((await pills.first().textContent()) ?? '').trim()
  expect(question.length).toBeGreaterThan(0)
  expect(question.length).toBeLessThanOrEqual(90)
  // Never the raw thought text (no fallback); the LLM wrote a question.
  expect(question).not.toBe(raw)
  expect(question).toMatch(/\?$/)

  const chatRequest = page.waitForRequest(
    (req) => req.method() === 'POST' && new URL(req.url()).pathname === '/api/chat',
  )
  await pills.first().click()
  const sent = (await chatRequest).postDataJSON() as { message?: string; question?: string }
  expect(sent.message ?? sent.question).toBe(question)
  await expect(page.getByRole('log', { name: 'Chat messages' })).toContainText(question)
}
