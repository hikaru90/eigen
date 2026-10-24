<script lang="ts">
  import { onMount } from 'svelte'
  import { browser } from '$app/environment'
  import { afterNavigate, onNavigate } from '$app/navigation'
  import { base } from '$app/paths'
  import { page } from '$app/state'
  import './layout.css'
  import {
    isPostHogEnabled,
    identify,
    resetPostHog,
    capturePageview,
  } from '$lib/analytics/posthog-client'
  import favicon from '$lib/assets/favicon.png'
  import averia400 from '$lib/assets/fonts/averia-libre-latin-400-normal.woff2?url'
  import averia700 from '$lib/assets/fonts/averia-libre-latin-700-normal.woff2?url'
  import geistMono400 from '$lib/assets/fonts/geist-mono-latin-400-normal.woff2?url'
  import inter400 from '$lib/assets/fonts/inter-latin-400-normal.woff2?url'
  import inter500 from '$lib/assets/fonts/inter-latin-500-normal.woff2?url'
  import { startCaptureQueueRunner } from '$lib/capture/queue'
  import BetaAgreementModal from '$lib/components/beta-agreement-modal.svelte'
  import AppChrome from '$lib/components/chrome/app-chrome.svelte'
  import BottomNav from '$lib/components/chrome/bottom-nav.svelte'
  import { activeNavId } from '$lib/components/chrome/nav-active'
  import { pageFadeVars } from '$lib/components/chrome/page-fade'
  import InstallPromptToast from '$lib/components/install-prompt-toast.svelte'
  import type { AuthorLayerMeta } from '$lib/graph/graph-author-layers'
  import { getLocale, setLocale } from '$lib/paraglide/runtime'
  import { startPushNavigationFromServiceWorker } from '$lib/push/navigation-from-sw'
  import { initDeferredInstallStore } from '$lib/pwa/deferred-install-store.svelte'
  import { initCurrentUserViewStore } from '$lib/stores/current-user-view.svelte'
  import { startThoughtSync } from '$lib/stores/thought-sync'

  let { children } = $props()

  // Keep the one-line inline array form: src/routes/auth-chrome.spec.ts asserts on it.
  const authPaths = new Set([
    '/login',
    '/signup',
    '/register',
    '/forgot-password',
    '/reset-password',
  ])

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

  const hideAppChrome = $derived(
    authPaths.has(normalizePathname(page.url.pathname)) ||
      (page.route.id != null && authPaths.has(page.route.id)),
  )

  const layoutUserId = $derived((page.data as { user?: { id: string } | null }).user?.id ?? null)

  /**
   * Which chrome fade overrides apply to the container: mesh pages fade beneath
   * their tabs, Ask and Make me better fade fully above their docked writers.
   * (ei styles.css body[data-view] overrides, kept simpler.)
   */
  const mainView = $derived.by(() => {
    const path = normalizePathname(page.url.pathname)
    if (path.startsWith('/feedback')) return 'feedback' as const
    return activeNavId(path)
  })

  /*
   * The one shell: every product page lives in here, full screen, under one mask that
   * fades content toward the edges — beneath the header (or the page's own tabs) and
   * above the bottom menu. The fade vars are per-view (pageFadeVars); the mask ramp is
   * the ei prototype's smootherstep (52px, faint 2–6% tails behind the chrome).
   */
  const fadeVars = $derived(pageFadeVars(mainView))
  const chromeMainClass = $derived.by(() => {
    if (hideAppChrome) {
      return 'static overflow-visible min-h-dvh mask-none animate-none'
    }
    return [
      'fixed inset-0 z-0 [view-transition-name:page]',
      // the app only ever scrolls vertically: x never scrolls, whatever a page renders
      mainView === 'ask' ? 'overflow-hidden' : 'overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-width:none]',
      fadeVars,
      '[--mask:linear-gradient(to_bottom,rgb(0_0_0/0.02)_0,rgb(0_0_0/0.06)_calc(var(--fade-top)_-_16px),rgb(0_0_0/0.068)_calc(var(--fade-top)_-_16px_+_5.2px),rgb(0_0_0/0.114)_calc(var(--fade-top)_-_16px_+_10.4px),rgb(0_0_0/0.213)_calc(var(--fade-top)_-_16px_+_15.6px),rgb(0_0_0/0.358)_calc(var(--fade-top)_-_16px_+_20.8px),rgb(0_0_0/0.53)_calc(var(--fade-top)_-_16px_+_26px),rgb(0_0_0/0.702)_calc(var(--fade-top)_-_16px_+_31.2px),rgb(0_0_0/0.847)_calc(var(--fade-top)_-_16px_+_36.4px),rgb(0_0_0/0.946)_calc(var(--fade-top)_-_16px_+_41.6px),rgb(0_0_0/0.992)_calc(var(--fade-top)_-_16px_+_46.8px),rgb(0_0_0/1)_calc(var(--fade-top)_+_36px),rgb(0_0_0/calc(var(--tail-bottom)_+_(1_-_var(--tail-bottom))*1))_calc(100%_-_var(--fade-bottom)_-_36px),rgb(0_0_0/calc(var(--tail-bottom)_+_(1_-_var(--tail-bottom))*0.991))_calc(100%_-_var(--fade-bottom)_-_30.8px),rgb(0_0_0/calc(var(--tail-bottom)_+_(1_-_var(--tail-bottom))*0.942))_calc(100%_-_var(--fade-bottom)_-_25.6px),rgb(0_0_0/calc(var(--tail-bottom)_+_(1_-_var(--tail-bottom))*0.837))_calc(100%_-_var(--fade-bottom)_-_20.4px),rgb(0_0_0/calc(var(--tail-bottom)_+_(1_-_var(--tail-bottom))*0.683))_calc(100%_-_var(--fade-bottom)_-_15.2px),rgb(0_0_0/calc(var(--tail-bottom)_+_(1_-_var(--tail-bottom))*0.5))_calc(100%_-_var(--fade-bottom)_-_10px),rgb(0_0_0/calc(var(--tail-bottom)_+_(1_-_var(--tail-bottom))*0.317))_calc(100%_-_var(--fade-bottom)_-_4.8px),rgb(0_0_0/calc(var(--tail-bottom)_+_(1_-_var(--tail-bottom))*0.163))_calc(100%_-_var(--fade-bottom)_+_0.4px),rgb(0_0_0/calc(var(--tail-bottom)_+_(1_-_var(--tail-bottom))*0.058))_calc(100%_-_var(--fade-bottom)_+_5.6px),rgb(0_0_0/calc(var(--tail-bottom)_+_(1_-_var(--tail-bottom))*0.009))_calc(100%_-_var(--fade-bottom)_+_10.8px),rgb(0_0_0/calc(var(--tail-bottom)_+_(1_-_var(--tail-bottom))*0))_calc(100%_-_var(--fade-bottom)_+_16px),rgb(0_0_0/calc(var(--tail-bottom)/3))_100%)]',
      '[-webkit-mask-image:var(--mask)] [mask-image:var(--mask)]',
      'animate-[enter_1.2s_var(--ease)_0.1s_backwards]',
    ].join(' ')
  })

  let mainEl = $state<HTMLElement | null>(null)

  /*
   * Route transitions: ei's view switch (styles.css `.view` / `.is-leaving`) — the old page
   * lifts and blurs out, the new one settles up from blur. Driven by the View Transitions API
   * from SvelteKit's onNavigate, so only the page container (`view-transition-name: page`)
   * and the Ask writer animate — opacity / transform / filter on snapshots, compositor-only.
   * The root (header, bottom nav) does not animate. Reduced motion and browsers without the
   * API navigate instantly.
   */
  onNavigate((nav) => {
    if (typeof document === 'undefined' || !document.startViewTransition) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (!nav.to || nav.from?.url.pathname === nav.to.url.pathname) return
    return new Promise<void>((resolve) => {
      document.startViewTransition(async () => {
        resolve()
        await nav.complete
      })
    })
  })

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
      // The product pages scroll inside the fixed container, so reset it on navigation
      // the way SvelteKit resets the window scroll.
      if (mainEl) mainEl.scrollTop = 0
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
  <!-- every face the first paint uses, fetched with the document so text never reflows on swap -->
  {#each [inter400, inter500, geistMono400, averia400, averia700] as font (font)}
    <link rel="preload" href={font} as="font" type="font/woff2" crossorigin="anonymous" />
  {/each}
</svelte:head>

{#if !hideAppChrome}
  <AppChrome />
{/if}

<!--
  One container: every product page lives in here, full screen, under one mask that
  fades content toward the edges — beneath the header (or the page's own tabs) and
  above the bottom menu. Header and nav float; only the mask does the fading.
-->
<main bind:this={mainEl} class={chromeMainClass}>
  {#if hideAppChrome}
    <div class="min-h-dvh pb-6">
      {@render children()}
    </div>
  {:else}
    <div class={mainView === 'ask' ? 'pb-0' : 'pb-28'}>
      {@render children()}
    </div>
  {/if}
</main>

{#if !hideAppChrome}
  <BottomNav />
{/if}

<BetaAgreementModal />

{#if !hideAppChrome && layoutUserId}
  <InstallPromptToast userId={layoutUserId} />
{/if}

