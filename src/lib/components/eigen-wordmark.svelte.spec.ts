import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page } from 'vitest/browser'
import EigenWordmark from './eigen-wordmark.svelte'

describe('eigen-wordmark.svelte', () => {
  it('sets the wordmark in the display face and passes class and id through', async () => {
    const { container } = render(EigenWordmark, {
      heightClass: 'h-12',
      class: 'custom-class',
      id: 'wordmark',
    })
    const word = page.getByText('Eigenmesh')
    await expect.element(word).toBeInTheDocument()
    await expect.element(word).toHaveClass('font-you')
    const root = container.querySelector('#wordmark')
    expect(root).not.toBeNull()
    expect(root?.classList.contains('custom-class')).toBe(true)
  })

  it('keeps the height box for layout consumers', async () => {
    const { container } = render(EigenWordmark, {
      tone: 'light',
      heightClass: 'h-12',
      id: 'light-wordmark',
    })
    await expect.element(page.getByText('Eigenmesh')).toBeInTheDocument()
    expect(container.querySelector('#light-wordmark .h-12')).not.toBeNull()
  })
})
