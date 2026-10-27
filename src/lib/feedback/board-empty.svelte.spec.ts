import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page } from 'vitest/browser'
import BoardEmpty from './board-empty.svelte'

describe('board-empty.svelte', () => {
  it('renders the whole-board headline and body, and the action calls its handler', async () => {
    const onsuggest = vi.fn()
    render(BoardEmpty, { variant: 'board', onsuggest })
    await expect.element(page.getByTestId('feedback-empty')).toBeInTheDocument()
    await expect.element(page.getByText('Nothing suggested yet.')).toBeInTheDocument()
    await expect.element(page.getByText(/get better at/)).toBeInTheDocument()
    await page.getByRole('button', { name: 'Suggest an idea' }).click()
    expect(onsuggest).toHaveBeenCalledTimes(1)
  })

  it('renders the per-tab variant', async () => {
    render(BoardEmpty, { variant: 'tab', onsuggest: () => {} })
    await expect.element(page.getByText('Nothing here right now.')).toBeInTheDocument()
    await expect.element(page.getByText(/move from requested to shipped/)).toBeInTheDocument()
  })
})
