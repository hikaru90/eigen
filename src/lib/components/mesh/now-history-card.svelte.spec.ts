import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page } from 'vitest/browser'
import NowHistoryCard from './now-history-card.svelte'

/** History of answered Now cards (feature-mesh-now.md NOW-14), with the endpoint stubbed. */

function item(n: number, over: Record<string, unknown> = {}) {
  return {
    cardId: `c${n}`,
    kind: 'do',
    text: `Text ${n}`,
    answer: 'done',
    projectLabel: null,
    answeredAt: new Date().toISOString(),
    thoughtId: `t${n}`,
    ...over,
  }
}
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const props = (count: number) => ({ count, timezone: 'Europe/Berlin' })

describe('now-history-card.svelte', () => {
  it('is hidden at count 0', async () => {
    render(NowHistoryCard, props(0))
    expect(document.querySelector('[data-testid="now-history"]')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows a collapsed toggle with the count and fetches nothing yet', async () => {
    render(NowHistoryCard, props(3))
    const toggle = page.getByRole('button', { name: /History/ })
    await expect.element(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect.element(toggle).toHaveTextContent('3')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches on the first open only, lists rows read-only with links and past-tense phrases', async () => {
    fetchMock.mockResolvedValueOnce(
      reply({
        items: [
          item(1),
          item(2, { kind: 'file', answer: 'other_project', projectLabel: 'Hydra' }),
          item(3, { kind: 'unblock', answer: 'someday', projectLabel: 'Sewer', thoughtId: null }),
        ],
        nextCursor: null,
      }),
    )
    render(NowHistoryCard, props(3))
    const toggle = page.getByRole('button', { name: /History/ })

    await toggle.click()
    await expect.element(page.getByText('Text 1')).toBeInTheDocument()
    await toggle.click()
    await toggle.click()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/mesh/now/history')
    await expect.element(page.getByText(/Marked done/)).toBeInTheDocument()
    await expect.element(page.getByText(/Moved to Hydra/)).toBeInTheDocument()
    await expect.element(page.getByText(/Sewer moved to Someday/)).toBeInTheDocument()
    await expect.element(page.getByRole('link', { name: 'Text 1' })).toHaveAttribute('href', '/thought/t1')
    expect(document.querySelector('[data-testid="now-history"] a[href="/thought/null"]')).toBeNull()
    // no answering controls inside the list
    expect(document.querySelectorAll('[data-testid="now-history-row"] button')).toHaveLength(0)
  })

  it('groups rows by day', async () => {
    fetchMock.mockResolvedValueOnce(
      reply({
        items: [item(1), item(2, { answeredAt: '2020-01-02T10:00:00.000Z' })],
        nextCursor: null,
      }),
    )
    render(NowHistoryCard, props(2))
    await page.getByRole('button', { name: /History/ }).click()
    await expect.element(page.getByText('Text 2')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-testid="now-history-day"]')).toHaveLength(2)
  })

  it('More loads the next page with the cursor and then disappears', async () => {
    fetchMock
      .mockResolvedValueOnce(reply({ items: [item(1)], nextCursor: 'cur1' }))
      .mockResolvedValueOnce(reply({ items: [item(2)], nextCursor: null }))
    render(NowHistoryCard, props(2))
    await page.getByRole('button', { name: /History/ }).click()
    await expect.element(page.getByText('Text 1')).toBeInTheDocument()

    await page.getByRole('button', { name: 'More' }).click()

    await expect.element(page.getByText('Text 2')).toBeInTheDocument()
    expect(String(fetchMock.mock.calls[1][0])).toContain('before=cur1')
    await expect.element(page.getByRole('button', { name: 'More' })).not.toBeInTheDocument()
  })

  it('a failed load says so', async () => {
    fetchMock.mockResolvedValueOnce(reply({ error: 'x' }, 500))
    render(NowHistoryCard, props(1))
    await page.getByRole('button', { name: /History/ }).click()
    await expect.element(page.getByText("History couldn't be loaded.")).toBeInTheDocument()
  })

  it('an answer on the card raises the count; Undo lowers it; an open list is read again', async () => {
    fetchMock
      .mockResolvedValueOnce(reply({ items: [item(1)], nextCursor: null }))
      .mockResolvedValueOnce(reply({ items: [item(2), item(1)], nextCursor: null }))
      .mockResolvedValueOnce(reply({ items: [item(1)], nextCursor: null }))
    const view = render(NowHistoryCard, props(1))
    const toggle = page.getByRole('button', { name: /History/ })
    await toggle.click()
    await expect.element(page.getByText('Text 1')).toBeInTheDocument()

    view.component.noteAnswered()
    await expect.element(page.getByText('Text 2')).toBeInTheDocument()

    view.component.noteUndone()
    await expect.element(page.getByText('Text 2')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('appears when the first answer is made and stays unfetched until opened', async () => {
    const view = render(NowHistoryCard, props(0))
    view.component.noteAnswered()
    await expect.element(page.getByRole('button', { name: /History/ })).toHaveTextContent('1')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
