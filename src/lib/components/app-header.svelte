<script lang="ts">
  import ActivityIcon from '@lucide/svelte/icons/activity'
  import BarChart3 from '@lucide/svelte/icons/bar-chart-3'
  import ClipboardCheck from '@lucide/svelte/icons/clipboard-check'
  import Cpu from '@lucide/svelte/icons/cpu'
  import HeartPulse from '@lucide/svelte/icons/heart-pulse'
  import KeyRound from '@lucide/svelte/icons/key-round'
  import Layers from '@lucide/svelte/icons/layers'
  import LogOut from '@lucide/svelte/icons/log-out'
  import Menu from '@lucide/svelte/icons/menu'
  import MessageSquare from '@lucide/svelte/icons/message-square'
  import Send from '@lucide/svelte/icons/send'
  import Settings from '@lucide/svelte/icons/settings'
  import { onMount } from 'svelte'
  import { dev } from '$app/environment'
  import { afterNavigate, goto } from '$app/navigation'
  import { base, resolve } from '$app/paths'
  import { page } from '$app/state'
  import { resetPostHog } from '$lib/analytics/posthog-client'
  import CurrentUserViewSelect from '$lib/components/current-user-view-select.svelte'
  import EigenWordmark from '$lib/components/eigen-wordmark.svelte'
  import * as Popover from '$lib/components/ui/popover'
  import { GRAPH_FILTER_GLASS_POPOVER } from '$lib/graph/graph-filter-chrome'
  import { chatSidebar } from '$lib/stores/chat-sidebar.svelte'

  let menuOpen = $state(false)

  onMount(() => {
    return afterNavigate(() => {
      menuOpen = false
      chatSidebar.open = false
    })
  })
  const user = $derived(
    (page.data as { user?: { email?: string | null; name?: string | null } }).user ?? null,
  )
  const showViewSelect = $derived(Boolean(user))
  const isAdmin = $derived((page.data as { isAdmin?: boolean }).isAdmin ?? false)

  async function signOut() {
    menuOpen = false
    const res = await fetch(`${base}/api/session/sign-out`, {
      method: 'POST',
      credentials: 'include',
    })
    if (!res.ok) {
      console.error('Sign out failed', res.status, await res.text().catch(() => ''))
      return
    }
    resetPostHog()
    await goto(resolve('/login'), { invalidateAll: true })
  }
</script>

<header class="fixed top-0 right-0 left-0 z-40 w-full bg-transparent px-5 pt-safe">
  <!-- Gradient blur stack: blur amount is the strength dial; mask gradient is the falloff dial -->
  <div
    aria-hidden="true"
    class="pointer-events-none absolute inset-x-0 top-0 z-0 h-20 backdrop-blur-sm"
    style="-webkit-mask-image: linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.92) 12%, rgba(0,0,0,0.78) 28%, rgba(0,0,0,0.58) 45%, rgba(0,0,0,0.35) 62%, rgba(0,0,0,0.15) 78%, rgba(0,0,0,0.04) 90%, transparent 100%); mask-image: linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.92) 12%, rgba(0,0,0,0.78) 28%, rgba(0,0,0,0.58) 45%, rgba(0,0,0,0.35) 62%, rgba(0,0,0,0.15) 78%, rgba(0,0,0,0.04) 90%, transparent 100%);"
  ></div>
  <div
    aria-hidden="true"
    class="pointer-events-none absolute inset-x-0 top-0 z-0 h-20 backdrop-blur-[2px]"
    style="-webkit-mask-image: linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.85) 18%, rgba(0,0,0,0.62) 38%, rgba(0,0,0,0.38) 58%, rgba(0,0,0,0.16) 78%, rgba(0,0,0,0.04) 90%, transparent 100%); mask-image: linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.85) 18%, rgba(0,0,0,0.62) 38%, rgba(0,0,0,0.38) 58%, rgba(0,0,0,0.16) 78%, rgba(0,0,0,0.04) 90%, transparent 100%);"
  ></div>
  <div
    aria-hidden="true"
    class="pointer-events-none absolute inset-x-0 top-0 z-0 h-20"
    style="background: linear-gradient(to bottom, var(--background) 0%, color-mix(in oklab, var(--background) 72%, transparent) 22%, color-mix(in oklab, var(--background) 40%, transparent) 48%, color-mix(in oklab, var(--background) 14%, transparent) 74%, transparent 100%);"
  ></div>
  <div class="relative z-10 mx-auto flex w-full items-center justify-between pb-3">
    {#if showViewSelect}
      <CurrentUserViewSelect />
    {:else}
      <div class="w-10"></div>
    {/if}
    <EigenWordmark
      class="absolute left-1/2 top-1/2 w-auto -translate-x-1/2 -translate-y-1/2"
      heightClass="h-8 lg:h-12"
    />
    <Popover.Root bind:open={menuOpen}>
      <Popover.Trigger
        class="relative flex size-10 cursor-pointer items-center justify-center bg-transparent text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
        aria-label="Account menu"
      >
        <Menu
          class="pointer-events-none relative z-10 size-6 shrink-0 text-black dark:text-white"
          aria-hidden="true"
          strokeWidth={1.75}
        />
      </Popover.Trigger>
      <Popover.Content
        align="end"
        side="bottom"
        sideOffset={4}
        class="{GRAPH_FILTER_GLASS_POPOVER} w-48 gap-1.5 overflow-hidden pt-2.5 pb-2 shadow-xl shadow-black/5 -mr-1"
      >
        <a
          href={resolve('/activity')}
          class="flex items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm text-foreground hover:bg-white/25 dark:hover:bg-white/10"
        >
          <ActivityIcon class="size-4 shrink-0 opacity-80" strokeWidth={1.75} />
          Activity
        </a>
        <a
          href={resolve('/api-keys')}
          class="flex items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm text-foreground hover:bg-white/25 dark:hover:bg-white/10"
        >
          <KeyRound class="size-4 shrink-0 opacity-80" strokeWidth={1.75} />
          API Keys
        </a>
        <a
          href={resolve('/settings/agents')}
          class="flex items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm text-foreground hover:bg-white/25 dark:hover:bg-white/10"
        >
          <Send class="size-4 shrink-0 opacity-80" strokeWidth={1.75} />
          Webhooks
        </a>
        <a
          href={resolve('/settings/llm')}
          class="flex items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm text-foreground hover:bg-white/25 dark:hover:bg-white/10"
        >
          <Cpu class="size-4 shrink-0 opacity-80" strokeWidth={1.75} />
          Credits
        </a>
        {#if isAdmin}
          <a
            href={resolve('/admin/queue')}
            class="flex items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm text-foreground hover:bg-white/25 dark:hover:bg-white/10"
          >
            <Layers class="size-4 shrink-0 opacity-80" strokeWidth={1.75} />
            Admin queue
          </a>
          <a
            href={resolve('/admin/spend')}
            class="flex items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm text-foreground hover:bg-white/25 dark:hover:bg-white/10"
          >
            <BarChart3 class="size-4 shrink-0 opacity-80" strokeWidth={1.75} />
            Admin spend
          </a>
        {/if}
        {#if dev}
          <a
            href={resolve('/eval')}
            class="flex items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm text-foreground hover:bg-white/25 dark:hover:bg-white/10"
          >
            <ClipboardCheck class="size-4 shrink-0 opacity-80" strokeWidth={1.75} />
            Evals
          </a>
        {/if}
        <a
          href={resolve('/settings/scheduled-tasks')}
          class="flex items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm text-foreground hover:bg-white/25 dark:hover:bg-white/10"
        >
          <HeartPulse class="size-4 shrink-0 opacity-80" strokeWidth={1.75} />
          Heartbeat
        </a>
        <a
          href={resolve('/settings')}
          class="flex items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm text-foreground hover:bg-white/25 dark:hover:bg-white/10"
        >
          <Settings class="size-4 shrink-0 opacity-80" strokeWidth={1.75} />
          Settings
        </a>
        {#if user?.email}
          <div
            class="mt-1 truncate border-t border-white/40 px-2 pt-3 text-sm text-muted-foreground dark:border-white/20"
          >
            {user.email}
          </div>
        {/if}
        <button
          type="button"
          class="flex w-full items-center gap-2.5 rounded-full px-2 py-1.5 text-left text-sm text-red-600 hover:bg-red-500/15 dark:text-red-400 dark:hover:bg-red-950/30"
          onclick={() => void signOut()}
        >
          <LogOut class="size-4 shrink-0 opacity-80" strokeWidth={1.75} />
          Log out
        </button>
        <a
          href={resolve('/feedback')}
          class="mt-1.5 flex items-center justify-center gap-2 rounded-[10px] shadow-xl shadow-green-400/40 mb-0.5 bg-[var(--color-eigen-green)] px-3 py-2.5 text-sm font-medium text-black hover:brightness-95 dark:bg-[var(--color-eigen-green)] dark:text-black dark:hover:brightness-95"
        >
          <MessageSquare class="size-3.5 shrink-0" strokeWidth={1.75} />
          Give us Feedback
        </a>
      </Popover.Content>
    </Popover.Root>
  </div>
</header>
