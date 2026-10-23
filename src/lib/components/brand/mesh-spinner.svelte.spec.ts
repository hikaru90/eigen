import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page } from 'vitest/browser'
import MeshSpinner from './mesh-spinner.svelte'

describe('mesh-spinner.svelte', () => {
  it('renders the still triangle by default', async () => {
    render(MeshSpinner, { id: 'mesh-spinner' })
    const spinner = page.locator('#mesh-spinner')
    await expect.element(spinner).toBeInTheDocument()
    await expect.element(spinner).toHaveAttribute('viewBox', '-12 -12 24 24')
    await expect.element(spinner).toHaveAttribute('aria-hidden', 'true')
  })

  it('accepts the working state and a size', async () => {
    render(MeshSpinner, { working: true, size: 16, id: 'mesh-spinner-working' })
    const spinner = page.locator('#mesh-spinner-working')
    await expect.element(spinner).toBeInTheDocument()
    await expect.element(spinner).toHaveAttribute('width', '16')
    await expect.element(spinner).toHaveAttribute('height', '16')
  })
})
