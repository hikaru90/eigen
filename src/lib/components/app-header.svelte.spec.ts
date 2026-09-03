import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page } from 'vitest/browser'
import AppHeader from './app-header.svelte'

const { gotoMock } = vi.hoisted(() => ({
  gotoMock: vi.fn(),
}))

vi.mock('$app/navigation', () => ({
  goto: gotoMock,
}))

vi.mock('$app/paths', () => ({
  base: '',
  resolve: (path: string) => path,
}))

describe('app-header.svelte', () => {
  it('renders account menu trigger and wordmark', async () => {
    render(AppHeader)
    await expect.element(page.getByLabelText('Account menu')).toBeInTheDocument()
    await expect.element(page.getByAltText('Eigen').first()).toBeInTheDocument()
  })

  it('opens popover and signs out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, text: async () => '' })),
    )
    render(AppHeader)
    await page.getByLabelText('Account menu').click()
    await page.getByRole('button', { name: 'Log out' }).click()
    expect(gotoMock).toHaveBeenCalledWith('/login', { invalidateAll: true })
  })

  it('renders a Give us Feedback menu entry linking to /feedback', async () => {
    render(AppHeader)
    await page.getByLabelText('Account menu').click()
    const feedbackLink = page.getByRole('link', { name: 'Give us Feedback' })
    await expect.element(feedbackLink).toBeInTheDocument()
    await expect.element(feedbackLink).toHaveAttribute('href', '/feedback')

    const logOut = page.getByRole('button', { name: 'Log out' })
    const feedbackEl = feedbackLink.element()
    const logOutEl = logOut.element()
    expect(
      Boolean(logOutEl.compareDocumentPosition(feedbackEl) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true)
  })
})
