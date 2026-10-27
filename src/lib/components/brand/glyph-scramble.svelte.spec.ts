import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page } from 'vitest/browser'
import GlyphScramble from './glyph-scramble.svelte'

const text = 'Interpreting'

function cellText() {
  return Array.from(
    page.getByTestId('glyph-scramble').element().querySelectorAll('[data-testid="glyph-cell"]'),
  ).map((c) => c.textContent)
}

describe('glyph-scramble.svelte', () => {
  afterEach(() => vi.restoreAllMocks())

  it('exposes the text as its accessible label and one cell per character', async () => {
    render(GlyphScramble, { text })
    await expect.element(page.getByRole('status')).toHaveAttribute('aria-label', text)
    expect(cellText()).toHaveLength(text.length)
  })

  it('settles into the real letters while looping', async () => {
    render(GlyphScramble, { text })
    await expect.poll(() => cellText().join(''), { timeout: 4000 }).toBe(text)
  })

  it('keeps spaces and the cell count stable', async () => {
    render(GlyphScramble, { text: 'a b' })
    await new Promise((r) => setTimeout(r, 300))
    const cells = cellText()
    expect(cells).toHaveLength(3)
    expect(cells[1]).toBe(' ')
  })

  it('renders plain static text under prefers-reduced-motion', async () => {
    const real = window.matchMedia.bind(window)
    vi.spyOn(window, 'matchMedia').mockImplementation((q: string) =>
      q.includes('prefers-reduced-motion')
        ? ({ ...real(q), matches: true } as MediaQueryList)
        : real(q),
    )
    render(GlyphScramble, { text })
    await new Promise((r) => setTimeout(r, 400))
    expect(cellText().join('')).toBe(text)
    expect(page.getByTestId('glyph-scramble').element().querySelector('.boxed')).toBeNull()
  })
})
