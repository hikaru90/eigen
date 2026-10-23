import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page, userEvent } from 'vitest/browser'
import { goto } from '$app/navigation'
import { page as stubAppPage } from '$lib/vitest-stubs/app/state'
import YouMenu from './you-menu.svelte'

vi.mock('$app/navigation', { spy: true })

function signIn() {
  stubAppPage.data = { user: { email: 'you@eigen.dev' } }
  stubAppPage.url = new URL('http://localhost/capture')
}

const MENU_LABEL = 'Profile · Settings'

describe('you-menu.svelte', () => {
  it('opens from the hamburger trigger and closes on Escape', async () => {
    signIn()
    render(YouMenu)
    const trigger = page.getByRole('button', { name: MENU_LABEL })
    await expect.element(trigger).toHaveAttribute('aria-expanded', 'false')

    await trigger.click()
    const menu = page.getByRole('menu', { name: MENU_LABEL })
    await expect.element(menu).toBeInTheDocument()
    await expect.element(trigger).toHaveAttribute('aria-expanded', 'true')

    await userEvent.keyboard('[Escape]')
    await expect.element(menu).not.toBeInTheDocument()
    await expect.element(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps the hamburger clickable while open so a second tap closes it', async () => {
    signIn()
    render(YouMenu)
    const trigger = page.getByRole('button', { name: MENU_LABEL })
    await trigger.click()
    expect(getComputedStyle(trigger.element()).pointerEvents).toBe('auto')
    await trigger.click()
    await expect.element(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows the signed-in email and the look options as radios', async () => {
    signIn()
    render(YouMenu)
    await page.getByRole('button', { name: MENU_LABEL }).click()

    const menu = page.getByRole('menu', { name: MENU_LABEL })
    await expect.element(menu.getByText('you@eigen.dev')).toBeInTheDocument()
    for (const label of ['Light', 'Dark', 'Auto']) {
      await expect.element(menu.getByRole('menuitemradio', { name: label })).toBeInTheDocument()
    }
  })
})

describe('you-menu selection', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it.each([
    ['Profile', '/settings'],
    ['API keys', '/api-keys'],
    ['Usage', '/activity'],
  ])('activates %s with a pointer and closes', async (label, href) => {
    signIn()
    render(YouMenu)
    await page.getByRole('button', { name: MENU_LABEL }).click()
    await page.getByRole('menuitem', { name: label, exact: true }).click()
    expect(goto).toHaveBeenCalledWith(href)
    await expect.element(page.getByRole('menu', { name: MENU_LABEL })).not.toBeInTheDocument()
  })

  it('activates a focused item with the keyboard', async () => {
    signIn()
    render(YouMenu)
    await page.getByRole('button', { name: MENU_LABEL }).click()
    await userEvent.keyboard('Profile[Enter]')
    expect(goto).toHaveBeenCalledWith('/settings')
  })

  it('signs out exactly once when selected', async () => {
    signIn()
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(YouMenu)
    await page.getByRole('button', { name: MENU_LABEL }).click()
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click()
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/session/sign-out', {
      method: 'POST',
      credentials: 'include',
    })
    await expect
      .poll(() => vi.mocked(goto).mock.calls)
      .toContainEqual(['/login', { invalidateAll: true }])
  })
})
