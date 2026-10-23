import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page } from 'vitest/browser'
import MenuMark from './menu-mark.svelte'

describe('menu-mark.svelte', () => {
  it('renders a decorative icon in CSS pixels for each kind', async () => {
    render(MenuMark, { kind: 'ask', id: 'menu-mark-ask' })
    const mark = page.locator('#menu-mark-ask')
    await expect.element(mark).toBeInTheDocument()
    await expect.element(mark).toHaveAttribute('data-kind', 'ask')
    await expect.element(mark).toHaveAttribute('aria-hidden', 'true')
    // One user unit is one CSS pixel, so every square is 4.4px on every surface.
    await expect.element(mark).toHaveAttribute('viewBox', '-18.36 -18.36 36.72 36.72')
  })

  it('carries the active state as a class the yarn CSS keys on', async () => {
    render(MenuMark, { kind: 'capture', active: true, id: 'menu-mark-capture' })
    const mark = page.locator('#menu-mark-capture')
    await expect.element(mark).toBeInTheDocument()
    await expect.element(mark).toHaveAttribute('data-kind', 'capture')
  })
})
