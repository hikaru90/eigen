import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page } from 'vitest/browser'
import EigenWordmark from './eigen-wordmark.svelte'

describe('eigen-wordmark.svelte', () => {
  it('renders both whole-logo variants without a separate mesh label', async () => {
    render(EigenWordmark, { heightClass: 'h-12', class: 'custom-class', id: 'wordmark' })
    await expect.element(page.getByAltText('Eigen Mesh').first()).toBeInTheDocument()
    await expect.element(page.getByAltText('Eigen Mesh').nth(1)).toBeInTheDocument()
    await expect.element(page.getByText('MESH')).not.toBeInTheDocument()
    await expect.element(page.locator('#wordmark')).toBeInTheDocument()
  })

  it('renders light tone with a single whole logo', async () => {
    render(EigenWordmark, { tone: 'light', heightClass: 'h-12', id: 'light-wordmark' })
    await expect.element(page.getByAltText('Eigen Mesh')).toBeInTheDocument()
    await expect.element(page.getByText('MESH')).not.toBeInTheDocument()
    await expect.element(page.locator('#light-wordmark')).toBeInTheDocument()
  })
})
