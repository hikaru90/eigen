import { expect, type Page } from '@playwright/test'
import { CHAT_ACTIVE_SESSION_STORAGE_KEY } from '../chat/chat-session-lifecycle'

/** Real chrome/CSS with deterministic chat responses: no LLM or billing calls. */
export async function assertNavigationAndAskLayout(page: Page, touch = false): Promise<void> {
  await page.goto('/capture')
  const burger = page.locator('.me-btn')
  await burger.click()
  await burger.click()
  await expect(page.getByTestId('you-menu')).toBeHidden()
  for (const [label, path] of [
    ['Profile', '/settings'],
    ['API keys', '/api-keys'],
    ['Usage', '/activity'],
  ]) {
    await burger.click()
    const item = page.getByRole('menuitem', { name: label, exact: true })
    if (touch) await item.tap()
    else await item.click()
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await expect(page.getByTestId('you-menu')).toBeHidden()
  }
  await page.goto('/mesh/yarn')
  const tabs = page.locator('.tabrow')
  await expect(tabs).toBeVisible()
  await expect.poll(async () => (await tabs.boundingBox())?.y ?? Infinity).toBeLessThan(100)

  await page.route('**/api/chat/sessions', (route) => route.fulfill({ json: { sessions: [] } }))
  const paragraphs = Array.from(
    { length: 45 },
    (_, i) => `Paragraph ${i + 1}: A longer answer to exercise conversation scrolling.`,
  ).join('\n\n')
  let requests = 0
  await page.route('**/api/chat', (route) => {
    requests += 1
    return route.fulfill({
      contentType: 'application/x-ndjson',
      body: `${JSON.stringify({ type: 'done', response: paragraphs, sessionId: 'layout-fixture', messageId: `answer-${requests}` })}\n`,
    })
  })
  try {
    await page.goto('/chat')
    const input = page.locator('.ask-input')
    const writer = page.locator('.ask-writer')
    await expect(input).toBeVisible()
    await expect.poll(async () => (await input.boundingBox())?.y ?? Infinity).toBeLessThan(180)
    await expect(page.locator('main .ask-writer')).toHaveCount(0)
    // Negative probe: an empty question cannot trigger a chat request.
    await expect(writer.getByRole('button', { name: 'Ask', exact: true })).toBeDisabled()
    expect(requests).toBe(0)
    await input.fill('Show me the things I remember.')
    await input.press('Enter')
    await expect(input).toBeEnabled()
    await expect(page.locator('.ask-thread')).toContainText('Paragraph 45:')
    await expect(writer).toHaveClass(/is-docked/)
    const dock = await writer.boundingBox()
    expect(dock).not.toBeNull()
    const scroll = page.locator('.ask-scroll')
    await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBeGreaterThan(100)
    const beforeScroll = await scroll.evaluate((el) => el.scrollTop)
    // Wheel over the overlay must scroll the conversation, leaving the input docked.
    await writer.hover()
    await page.mouse.wheel(0, -800)
    await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBeLessThan(beforeScroll - 100)
    await expect.poll(async () => (await writer.boundingBox())?.y).toBeCloseTo(dock!.y, 0)
    await input.fill('And what else?')
    await input.press('Enter')
    await expect.poll(() => requests).toBe(2)
    await expect(input).toBeEnabled()
    await expect(input).toBeInViewport()
    const nav = await page.getByRole('navigation', { name: 'Main', exact: true }).boundingBox()
    const end = await writer.boundingBox()
    expect(end!.y + end!.height).toBeLessThanOrEqual(nav!.y)
  } finally {
    await page.unroute('**/api/chat')
    await page.unroute('**/api/chat/sessions')
    await page.evaluate((key) => localStorage.removeItem(key), CHAT_ACTIVE_SESSION_STORAGE_KEY)
  }
}
