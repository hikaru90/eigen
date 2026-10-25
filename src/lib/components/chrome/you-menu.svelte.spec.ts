import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page, userEvent } from 'vitest/browser'
import { goto } from '$app/navigation'
import { page as stubAppPage } from '$lib/vitest-stubs/app/state'
import { deferredInstallState } from '$lib/pwa/deferred-install-store.svelte'
import type { BeforeInstallPromptEvent } from '$lib/pwa/install'
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

  it('enumerates the mesh (thoughts · threads) and the API keys like ei', async () => {
    stubAppPage.data = {
      user: { email: 'you@eigen.dev' },
      youCounts: { thoughts: 142, threads: 3, apiKeys: 1 },
    }
    render(YouMenu)
    await page.getByRole('button', { name: MENU_LABEL }).click()
    const menu = page.getByRole('menu', { name: MENU_LABEL })
    await expect.element(menu.getByText('142 thoughts · 3 threads')).toBeInTheDocument()
    await expect.element(menu.getByText('1 key', { exact: true })).toBeInTheDocument()
  })

  it('shows usage as a bar of the credits left since the last top-up', async () => {
    stubAppPage.data = {
      user: { email: 'you@eigen.dev' },
      youCounts: { thoughts: 1, threads: 0, apiKeys: 0, credits: { available: 750, spentSinceFunding: 250 } },
    }
    render(YouMenu)
    await page.getByRole('button', { name: MENU_LABEL }).click()
    const menu = page.getByRole('menu', { name: MENU_LABEL })
    await expect.element(menu.getByText('750 credits left')).toBeInTheDocument()
    const fill = page.getByTestId('you-usage-fill').element() as HTMLElement
    expect(fill.style.width).toBe('75%')
    // the item keeps its plain name: the bar and its figure are decoration for sighted users
    await expect.element(page.getByRole('menuitem', { name: 'Usage', exact: true })).toBeInTheDocument()
  })

  it('lists Notifications with the unread count', async () => {
    stubAppPage.data = {
      user: { email: 'you@eigen.dev' },
      youCounts: { thoughts: 1, threads: 0, apiKeys: 0, credits: null, notificationsUnread: 2 },
    }
    render(YouMenu)
    await page.getByRole('button', { name: MENU_LABEL }).click()
    await expect.element(page.getByRole('menuitem', { name: 'Notifications' })).toBeInTheDocument()
    await expect.element(page.getByTestId('you-notifications-unread')).toHaveTextContent('2')
  })

  it('shows no usage bar before the user has a wallet', async () => {
    stubAppPage.data = {
      user: { email: 'you@eigen.dev' },
      youCounts: { thoughts: 1, threads: 0, apiKeys: 0, credits: null },
    }
    render(YouMenu)
    await page.getByRole('button', { name: MENU_LABEL }).click()
    await expect.element(page.getByRole('menu', { name: MENU_LABEL })).toBeInTheDocument()
    await expect.element(page.getByTestId('you-usage-fill')).not.toBeInTheDocument()
  })
})

describe('you-menu selection', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it.each([
    ['Notifications', '/notifications'],
    ['Preferences', '/settings'],
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
    await userEvent.keyboard('Preferences[Enter]')
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

  describe('install app', () => {
    afterEach(() => {
      deferredInstallState.deferred = null
      deferredInstallState.installed = false
    })

    function offerPrompt(outcome: 'accepted' | 'dismissed') {
      const prompt = vi.fn(async () => undefined)
      deferredInstallState.deferred = Object.assign(new Event('beforeinstallprompt'), {
        prompt,
        userChoice: Promise.resolve({ outcome }),
      }) as BeforeInstallPromptEvent
      return prompt
    }

    it('offers one-click install when the browser has an install prompt', async () => {
      signIn()
      const prompt = offerPrompt('accepted')
      render(YouMenu)
      await page.getByRole('button', { name: MENU_LABEL }).click()
      await page.getByRole('menuitem', { name: 'Install app', exact: true }).click()
      expect(prompt).toHaveBeenCalledTimes(1)
      await expect.poll(() => deferredInstallState.installed).toBe(true)
    })

    it('hides the install item once the app is installed', async () => {
      signIn()
      offerPrompt('accepted')
      deferredInstallState.installed = true
      render(YouMenu)
      await page.getByRole('button', { name: MENU_LABEL }).click()
      await expect.element(page.getByRole('menu', { name: MENU_LABEL })).toBeInTheDocument()
      await expect
        .element(page.getByRole('menuitem', { name: 'Install app', exact: true }))
        .not.toBeInTheDocument()
    })

    it('hides the install item when the browser offers no install prompt (and is not iOS)', async () => {
      signIn()
      render(YouMenu)
      await page.getByRole('button', { name: MENU_LABEL }).click()
      await expect.element(page.getByRole('menu', { name: MENU_LABEL })).toBeInTheDocument()
      await expect
        .element(page.getByRole('menuitem', { name: 'Install app', exact: true }))
        .not.toBeInTheDocument()
    })
  })
})
