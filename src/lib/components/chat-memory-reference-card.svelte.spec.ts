import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page } from 'vitest/browser'
import ChatMemoryReferenceCard from './chat-memory-reference-card.svelte'

const ID = '1ae96143-0000-4000-8000-000000000000'
const LONG = 'A thought long enough that it cannot possibly fit on one line of the card. '.repeat(6)

function renderCard(props: Record<string, unknown> = {}) {
  const ul = document.createElement('ul')
  document.body.appendChild(ul)
  return render(ChatMemoryReferenceCard, {
    target: ul,
    props: { id: ID, text: LONG, category: 'observation', ...props },
  })
}

describe('chat-memory-reference-card.svelte', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('shows the type pill and one clamped line, never the thought id or a link out', async () => {
    renderCard()
    await expect.element(page.getByTestId('chat-memory-type')).toHaveTextContent('Observation')
    const text = page.getByTestId('chat-memory-text')
    await expect.element(text).toHaveClass('truncate')
    const card = page.getByTestId('chat-memory-card').element()
    expect(card.textContent).not.toMatch(/1ae96143/i)
    expect(card.querySelector('a')).toBeNull()
  })

  it('is one line where type, text and caret all sit inside the toggle', async () => {
    renderCard()
    const toggle = page.getByTestId('chat-memory-toggle').element()
    expect(toggle.querySelector('[data-testid="chat-memory-type"]')).not.toBeNull()
    expect(toggle.querySelector('[data-testid="chat-memory-text"]')).not.toBeNull()
    expect(toggle.querySelector('svg')).not.toBeNull()
  })

  it('expands inline on the chevron, loading details on click', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.startsWith('/api/thoughts/')
        ? new Response(JSON.stringify({ normalizedText: LONG.trim(), category: 'observation' }))
        : new Response(JSON.stringify({ results: [{ id: 'other', normalizedText: 'A linked thought' }] })),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderCard()
    const toggle = page.getByTestId('chat-memory-toggle')
    await expect.element(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(fetchMock).not.toHaveBeenCalled()

    await toggle.click()
    await expect.element(toggle).toHaveAttribute('aria-expanded', 'true')
    const region = page.getByTestId('chat-memory-details')
    await expect.element(region).toHaveAttribute('id', toggle.element().getAttribute('aria-controls')!)
    await expect.element(page.getByText('A linked thought')).toBeInTheDocument()
    await expect.element(page.getByTestId('chat-memory-text')).not.toHaveClass('truncate')
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/thoughts/${ID}`)
    expect(window.location.pathname).not.toContain('/thought/')

    await toggle.click()
    await expect.element(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('says so when the details cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    renderCard()
    await page.getByTestId('chat-memory-toggle').click()
    await expect.element(page.getByRole('alert')).toBeInTheDocument()
  })
})
