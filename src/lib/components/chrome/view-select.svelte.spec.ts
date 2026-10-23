import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page } from 'vitest/browser'
import { getCurrentUserView, setCurrentUserView } from '$lib/stores/current-user-view.svelte'
import { page as stubAppPage } from '$lib/vitest-stubs/app/state'
import ViewSelect from './view-select.svelte'

/** Signed-in page data with one agent layer, matching what +layout.server.ts loads. */
function signIn() {
  stubAppPage.data = {
    user: { email: 'you@eigen.dev' },
    authorLayers: [
      { key: 'user', label: 'You', kind: 'user' },
      { key: 'apikey:scout', label: 'Scout', kind: 'agent' },
    ],
  }
  stubAppPage.url = new URL('http://localhost/capture')
}

describe('view-select.svelte', () => {
  it('shows the current view beside the header icon', async () => {
    signIn()
    setCurrentUserView('user')
    render(ViewSelect)
    const trigger = page.getByRole('button', { name: 'You' })
    await expect.element(trigger).toBeInTheDocument()
    await expect.element(trigger).toHaveAttribute('aria-haspopup', 'menu')
  })

  it('renders nothing when signed out', async () => {
    stubAppPage.data = {}
    render(ViewSelect)
    await expect.element(page.getByRole('button')).not.toBeInTheDocument()
  })

  it('opens the dropdown with one row per layer and marks the active view', async () => {
    signIn()
    setCurrentUserView('user')
    render(ViewSelect)
    await page.getByRole('button', { name: 'You' }).click()

    const menu = page.getByRole('menu', { name: 'View as' })
    await expect.element(menu).toBeInTheDocument()
    for (const label of ['You', 'Scout', 'All Users']) {
      await expect.element(menu.getByRole('menuitemradio', { name: label })).toBeInTheDocument()
    }
    await expect
      .element(menu.getByRole('menuitemradio', { name: 'You' }))
      .toHaveAttribute('aria-checked', 'true')
    await expect
      .element(menu.getByRole('menuitemradio', { name: 'Scout' }))
      .toHaveAttribute('aria-checked', 'false')
  })

  it('stays visible when the user layer is the only view', async () => {
    stubAppPage.data = {
      user: { email: 'you@eigen.dev' },
      authorLayers: [{ key: 'user', label: 'You', kind: 'user' }],
    }
    stubAppPage.url = new URL('http://localhost/capture')
    setCurrentUserView('user')
    render(ViewSelect)
    await expect.element(page.getByRole('button', { name: 'You' })).toBeInTheDocument()
  })

  it('switches the view on pick and reflects it in the trigger', async () => {
    signIn()
    setCurrentUserView('user')
    render(ViewSelect)
    await page.getByRole('button', { name: 'You' }).click()
    await page.getByRole('menuitemradio', { name: 'Scout' }).click()

    expect(getCurrentUserView()).toBe('apikey:scout')
    await expect.element(page.getByRole('button', { name: 'Scout' })).toBeInTheDocument()
    await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  })
})
