<script lang="ts">
  import Brain from '@lucide/svelte/icons/brain'
  import MessageSquareText from '@lucide/svelte/icons/message-square-text'
  import Plus from '@lucide/svelte/icons/plus'
  import { onMount } from 'svelte'
  import { browser } from '$app/environment'
  import { afterNavigate } from '$app/navigation'
  import { base } from '$app/paths'
  import { resolveAppPath } from '$lib/navigation/resolve-app-path'
  import { page } from '$app/state'
  import type { Pathname } from '$app/types'
  import './layout.css'
  import {
    isPostHogEnabled,
    identify,
    resetPostHog,
    capturePageview,
  } from '$lib/analytics/posthog-client'
  import favicon from '$lib/assets/favicon.png'
  import { startCaptureQueueRunner } from '$lib/capture/queue'
  import AppHeader from '$lib/components/app-header.svelte'
  import InstallPromptToast from '$lib/components/install-prompt-toast.svelte'
  import type { AuthorLayerMeta } from '$lib/graph/graph-author-layers'
  import { m } from '$lib/paraglide/messages.js'
  import { getLocale, setLocale } from '$lib/paraglide/runtime'
  import { startPushNavigationFromServiceWorker } from '$lib/push/navigation-from-sw'
  import { initDeferredInstallStore } from '$lib/pwa/deferred-install-store.svelte'
  import { initCurrentUserViewStore } from '$lib/stores/current-user-view.svelte'
  import { startThoughtSync } from '$lib/stores/thought-sync'
  import { cn } from '$lib/utils'

  let { children } = $props()

  const authPaths = new Set(['/login', '/signup', '/register'])

  function normalizePathname(pathname: string): string {
    let p = pathname
    if (base && p.startsWith(base)) {
      p = p.slice(base.length) || '/'
    }
    if (p.length > 1 && p.endsWith('/')) {
      p = p.slice(0, -1)
    }
    return p || '/'
  }

  function isNavItemActive(href: string): boolean {
    const current = normalizePathname(page.url.pathname)
    const target = normalizePathname(href)
    if (current === target) return true
    if (target === '/memory') return current.startsWith('/memory')
    if (target === '/chat') return current.startsWith('/chat')
    return current.startsWith(`${target}/`)
  }

  const hideAppChrome = $derived(
    authPaths.has(normalizePathname(page.url.pathname)) ||
      (page.route.id != null && authPaths.has(page.route.id)),
  )

  const layoutUserId = $derived(
    (page.data as { user?: { id: string } | null }).user?.id ?? null,
  )

  let themePreference = 'system'
  let lastIdentifiedUserId: string | null | undefined = undefined
  let stopInstallStore: (() => void) | null = null

  function syncPostHogIdentity() {
    if (!browser) return
    const user = (page.data as { user?: { id: string; email?: string; name?: string } | null }).user
    const isAdmin = (page.data as { isAdmin?: boolean }).isAdmin ?? false
    if (user?.id) {
      if (lastIdentifiedUserId === user.id) return
      identify(user.id, { email: user.email, name: user.name, is_admin: isAdmin })
      lastIdentifiedUserId = user.id
    } else if (lastIdentifiedUserId !== null) {
      resetPostHog()
      lastIdentifiedUserId = null
    }
  }

  const bottomNavItems = $derived([
    {
      label: m.nav_memory(),
      href: '/memory',
      icon: Brain,
      variant: 'secondary' as const,
    },
    {
      label: m.nav_capture(),
      href: '/capture',
      icon: Plus,
      variant: 'primary' as const,
    },
    {
      label: m.nav_chat(),
      href: '/chat',
      icon: MessageSquareText,
      variant: 'secondary' as const,
    },
  ])

  onMount(() => {
    syncPostHogIdentity()
    const layoutUser = (page.data as { user?: { id: string } | null }).user
    if (layoutUser) {
      const layers = (page.data as { authorLayers?: AuthorLayerMeta[] }).authorLayers ?? []
      initCurrentUserViewStore(layers)
      // Capture the beforeinstallprompt event app-wide so the install banner
      // and the onboarding overlay share one deferred event (Chrome/Edge only
      // fires it once per session).
      stopInstallStore = initDeferredInstallStore()
    }

    const posthogReady = isPostHogEnabled()
    if (posthogReady) {
      const initialPath = normalizePathname(page.url.pathname)
      if (!authPaths.has(initialPath)) {
        capturePageview(initialPath)
      }
    }
    afterNavigate((nav) => {
      syncPostHogIdentity()
      const path = normalizePathname(nav.to?.url.pathname ?? page.url.pathname)
      if (!authPaths.has(path)) {
        capturePageview(path)
      }
    })

    const stopPushNavigation = startPushNavigationFromServiceWorker()

    if ((page.data as { user?: { id: string } | null }).user) {
      startCaptureQueueRunner()
      startThoughtSync()
    }

    const preferredUiLocale = (page.data as { preferredUiLocale?: string | null }).preferredUiLocale
    if (preferredUiLocale && getLocale() !== preferredUiLocale) {
      setLocale(preferredUiLocale as 'en' | 'de')
    }

    void (async () => {
      try {
        const { pwaInfo } = await import('virtual:pwa-info')
        if (!pwaInfo) return
        const { registerSW } = await import('virtual:pwa-register')
        registerSW({ immediate: true })
      } catch {
        /* PWA plugin unavailable (e.g. test env) */
      }
    })()

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const syncThemeColorMeta = () => {
      const meta = document.getElementById('theme-color-meta')
      if (!meta) return
      const themeColor = getComputedStyle(document.documentElement)
        .getPropertyValue('--theme-color')
        .trim()
      if (themeColor) meta.setAttribute('content', themeColor)
    }

    const applyTheme = (isDark: boolean) => {
      document.documentElement.classList.toggle('dark', isDark)
      document.documentElement.style.colorScheme = isDark ? 'dark' : 'light'
      syncThemeColorMeta()
    }
    const applyThemePreference = (preference: string) => {
      themePreference = preference
      const useDark = preference === 'dark' || (preference === 'system' && media.matches)
      applyTheme(useDark)
    }
    const savedPreference = localStorage.getItem('theme-preference') ?? 'system'
    applyThemePreference(savedPreference)

    const handleChange = (event: MediaQueryListEvent) => {
      if (themePreference === 'system') {
        applyTheme(event.matches)
      }
    }
    const handlePreferenceChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ preference?: string }>
      applyThemePreference(customEvent.detail?.preference ?? 'system')
    }
    media.addEventListener('change', handleChange)
    window.addEventListener('theme-preference-change', handlePreferenceChange)
    return () => {
      stopPushNavigation()
      stopInstallStore?.()
      stopInstallStore = null
      media.removeEventListener('change', handleChange)
      window.removeEventListener('theme-preference-change', handlePreferenceChange)
    }
  })
</script>

<svelte:head>
  <title>Eigen Mesh</title>
  <link rel="icon" href={favicon} />
</svelte:head>

<div class="bg-background min-h-dvh" class:pb-28={!hideAppChrome} class:pb-6={hideAppChrome}>
  {#if !hideAppChrome}
    <AppHeader />
  {/if}
  {@render children()}
</div>

{#if !hideAppChrome && layoutUserId}
  <InstallPromptToast userId={layoutUserId} />
{/if}

{#if !hideAppChrome}
  <nav
    class="fixed bottom-0 left-0 right-0 z-20 text-foreground dark:text-white"
    aria-label="Main navigation"
  >
    <!-- Gradient blur stack (mirrors header, inverted): full at bottom, fades upward -->
    <div
      aria-hidden="true"
      class="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-20 backdrop-blur-sm"
      style="-webkit-mask-image: linear-gradient(to top, rgba(0,0,0,1) 0%, rgba(0,0,0,0.92) 12%, rgba(0,0,0,0.78) 28%, rgba(0,0,0,0.58) 45%, rgba(0,0,0,0.35) 62%, rgba(0,0,0,0.15) 78%, rgba(0,0,0,0.04) 90%, transparent 100%); mask-image: linear-gradient(to top, rgba(0,0,0,1) 0%, rgba(0,0,0,0.92) 12%, rgba(0,0,0,0.78) 28%, rgba(0,0,0,0.58) 45%, rgba(0,0,0,0.35) 62%, rgba(0,0,0,0.15) 78%, rgba(0,0,0,0.04) 90%, transparent 100%);"
    ></div>
    <div
      aria-hidden="true"
      class="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-20 backdrop-blur-[2px]"
      style="-webkit-mask-image: linear-gradient(to top, rgba(0,0,0,1) 0%, rgba(0,0,0,0.85) 18%, rgba(0,0,0,0.62) 38%, rgba(0,0,0,0.38) 58%, rgba(0,0,0,0.16) 78%, rgba(0,0,0,0.04) 90%, transparent 100%); mask-image: linear-gradient(to top, rgba(0,0,0,1) 0%, rgba(0,0,0,0.85) 18%, rgba(0,0,0,0.62) 38%, rgba(0,0,0,0.38) 58%, rgba(0,0,0,0.16) 78%, rgba(0,0,0,0.04) 90%, transparent 100%);"
    ></div>
    <div
      aria-hidden="true"
      class="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-20"
      style="background: linear-gradient(to top, var(--background) 0%, color-mix(in oklab, var(--background) 72%, transparent) 22%, color-mix(in oklab, var(--background) 40%, transparent) 48%, color-mix(in oklab, var(--background) 14%, transparent) 74%, transparent 100%);"
    ></div>
    <div class="relative z-10 flex flex-row items-center justify-between gap-2 px-4 pb-safe">
      {#each bottomNavItems as item (item.href)}
        {@const isActive = isNavItemActive(item.href)}
        <div class={cn('relative', item.variant === 'primary' ? 'min-h-10 flex-1' : 'shrink-0')}>
          <a
            href={resolveAppPath(item.href)}
            class={cn(
              'flex items-center justify-center',
              item.variant === 'primary'
                ? 'w-full rounded-full bg-primary py-4 text-primary-foreground shadow-md dark:border dark:border-white/15 dark:bg-black/70 dark:text-white dark:shadow-none dark:backdrop-blur-md dark:hover:bg-black/80'
                : 'size-10 rounded-full border border-transparent bg-black text-white hover:bg-black/90 dark:border-white/15 dark:bg-black/70 dark:text-white dark:backdrop-blur-md dark:hover:bg-black/80',
            )}
            aria-label={item.label}
            aria-current={isActive ? 'page' : undefined}
          >
            <item.icon
              class={cn('size-4.5', isActive && 'text-[var(--color-eigen-green)]')}
              strokeWidth={1.75}
            />
          </a>
        </div>
      {/each}
    </div>
  </nav>
{/if}
