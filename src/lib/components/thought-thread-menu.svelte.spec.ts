import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page } from 'vitest/browser'
import ThoughtThreadMenu from './thought-thread-menu.svelte'

describe('thought-thread-menu.svelte', () => {
  it('offers leaving the thread when one is assigned', async () => {
    const onUnassign = vi.fn()
    render(ThoughtThreadMenu, {
      thread: { entityId: 'p1', label: 'EigenMesh' },
      open: true,
      onUnassign,
    })
    const row = page.getByTestId('thought-thread-unassign')
    await expect.element(row).toBeInTheDocument()
    await row.click()
    expect(onUnassign).toHaveBeenCalledTimes(1)
  })

  it('offers no leaving row when the thought is already loose', async () => {
    render(ThoughtThreadMenu, { thread: null, open: true })
    await expect.element(page.getByTestId('thought-thread-unassign')).not.toBeInTheDocument()
  })
})
