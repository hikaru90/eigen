import { expect, type Page } from '@playwright/test'

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
    const input = page.getByTestId('ask-input')
    const writer = page.getByTestId('glass-writer')
    await expect(input).toBeVisible()
    // the shared writer is docked at the bottom from the start, outside the masked <main>
    const viewport = page.viewportSize()
    await expect
      .poll(async () => (await writer.boundingBox())?.y ?? 0)
      .toBeGreaterThan((viewport?.height ?? 0) / 2)
    await expect(page.locator('main [data-testid="glass-writer"]')).toHaveCount(0)
    // Negative probe: an empty question offers no send action and Enter sends nothing.
    await expect(page.getByTestId('ask-submit')).toHaveCount(0)
    await input.press('Enter')
    expect(requests).toBe(0)
    await input.fill('Show me the things I remember.')
    await input.press('Enter')
    await expect(input).toBeEnabled()
    await expect(page.getByRole('log', { name: 'Chat messages' })).toContainText('Paragraph 45:')
    const dock = await writer.boundingBox()
    expect(dock).not.toBeNull()
    const scroll = page.getByRole('log', { name: 'Chat messages' })
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
  }
}
