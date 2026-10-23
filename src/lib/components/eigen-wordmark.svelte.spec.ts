import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page } from 'vitest/browser'
import EigenWordmark from './eigen-wordmark.svelte'

describe('eigen-wordmark.svelte', () => {
  it('renders the Geist Mono wordmark with class and id passthrough', async () => {
    render(EigenWordmark, { heightClass: 'h-12', class: 'custom-class', id: 'wordmark' })
    await expect.element(page.getByText('Eigenmesh')).toBeInTheDocument()
    await expect.element(page.locator('#wordmark')).toBeInTheDocument()
  })

  it('keeps the height box for layout consumers', async () => {
    render(EigenWordmark, { tone: 'light', heightClass: 'h-12', id: 'light-wordmark' })
    await expect.element(page.getByText('Eigenmesh')).toBeInTheDocument()
    await expect.element(page.locator('#light-wordmark .h-12')).toBeInTheDocument()
  })
})
