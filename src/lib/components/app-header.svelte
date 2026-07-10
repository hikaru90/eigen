<script lang="ts">
  import { dev } from "$app/environment";
  import { base, resolve } from "$app/paths";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import EigenWordmark from "$lib/components/eigen-wordmark.svelte";
  import CurrentUserViewSelect from "$lib/components/current-user-view-select.svelte";
  import * as Popover from "$lib/components/ui/popover";
  import { chatSidebarOpen } from "$lib/stores/chat-sidebar";
  import ActivityIcon from "@lucide/svelte/icons/activity";
  import Menu from "@lucide/svelte/icons/menu";
  import Settings from "@lucide/svelte/icons/settings";
  import KeyRound from "@lucide/svelte/icons/key-round";
  import LogOut from "@lucide/svelte/icons/log-out";
  import ClipboardCheck from "@lucide/svelte/icons/clipboard-check";
  import Cpu from "@lucide/svelte/icons/cpu";
  import HeartPulse from "@lucide/svelte/icons/heart-pulse";
  import BarChart3 from "@lucide/svelte/icons/bar-chart-3";
  import Layers from "@lucide/svelte/icons/layers";
  import Send from "@lucide/svelte/icons/send";
  import { resetPostHog } from "$lib/analytics/posthog-client";
  import { GRAPH_FILTER_GLASS_POPOVER } from "$lib/graph/graph-filter-chrome";

  const isChatRoute = $derived(page.route.id === "/chat");

  let menuOpen = $state(false);

  $effect(() => {
    // Close the popover on any client-side navigation.
    page.url.pathname;
    menuOpen = false;
    chatSidebarOpen.set(false);
  });
  const user = $derived(
    (page.data as { user?: { email?: string | null; name?: string | null } }).user ?? null,
  );
  const showViewSelect = $derived(Boolean(user));
  const isAdmin = $derived((page.data as { isAdmin?: boolean }).isAdmin ?? false);
  const userEmail = $derived(user?.email?.trim().toLowerCase() || "anonymous");

  function hashString(input: string): number {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function createSeededRandom(seed: number): () => number {
    return () => {
      seed += 0x6d2b79f5;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createTextureDataUri(email: string): string {
    const seed = hashString(email);
    const rand = createSeededRandom(seed);
    const hue = Math.floor(rand() * 360);
    const bg = "#242424";
    const fg = "#E3EADE";
    const dots: string[] = [];
    for (let i = 0; i < 72; i++) {
      const x = (rand() * 64).toFixed(2);
      const y = (rand() * 64).toFixed(2);
      const r = (rand() * 1.2 + 0.55).toFixed(2);
      const a = (rand() * 0.58 + 0.06).toFixed(3);
      dots.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${fg}" opacity="${a}" />`);
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" fill="${bg}"/>${dots.join("")}</svg>`;
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
  }

  const avatarTexture = $derived(createTextureDataUri(userEmail));

  async function signOut() {
    menuOpen = false;
    const res = await fetch(`${base}/api/session/sign-out`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      console.error("Sign out failed", res.status, await res.text().catch(() => ""));
      return;
    }
    resetPostHog();
    await goto(resolve("/login"), { invalidateAll: true });
  }
</script>

<header class="fixed top-0 right-0 left-0 z-40 w-full bg-transparent px-5 pt-safe">
  <!-- Gradient blur stack: full blur at top, fading to none -->
  <div aria-hidden="true" class="pointer-events-none absolute inset-x-0 top-0 z-0 h-24 backdrop-blur-md" style="-webkit-mask-image: linear-gradient(to bottom, black 0%, black 20%, transparent 40%); mask-image: linear-gradient(to bottom, black 0%, black 20%, transparent 40%);"></div>
  <div aria-hidden="true" class="pointer-events-none absolute inset-x-0 top-0 z-0 h-24 backdrop-blur-sm" style="-webkit-mask-image: linear-gradient(to bottom, transparent 15%, black 30%, black 40%, transparent 55%); mask-image: linear-gradient(to bottom, transparent 15%, black 30%, black 40%, transparent 55%);"></div>
  <div aria-hidden="true" class="pointer-events-none absolute inset-x-0 top-0 z-0 h-24 bg-linear-to-b from-background to-transparent"></div>
  <div class="relative z-10 mx-auto flex w-full items-center justify-between pb-3">
    {#if isChatRoute}
      <div class="flex items-center gap-1">
        <button
          class="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
          onclick={() => chatSidebarOpen.update((v) => !v)}
          aria-label="Toggle session list"
        >
          <Menu class="size-5" strokeWidth={1.75} />
        </button>
        {#if showViewSelect}
          <CurrentUserViewSelect />
        {/if}
      </div>
    {:else if showViewSelect}
      <CurrentUserViewSelect />
    {:else}
      <div class="w-10"></div>
    {/if}
    <EigenWordmark heightClass="h-8" />
    <Popover.Root bind:open={menuOpen}>
      <Popover.Trigger
        class="relative flex size-9 cursor-pointer items-center justify-center bg-transparent text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
        aria-label="Account menu"
      >
        <Menu
          class="pointer-events-none relative z-10 size-5 shrink-0 text-black dark:text-white"
          aria-hidden="true"
          strokeWidth={1.75}
        />
      </Popover.Trigger>
      <Popover.Content
        align="end"
        side="bottom"
        sideOffset={8}
        class="{GRAPH_FILTER_GLASS_POPOVER} w-44 gap-0 px-1 pt-3 pb-2 shadow-xl shadow-black/5"
      >
        <a
          href={resolve("/activity")}
          class="flex items-center gap-2 rounded-sm px-3 py-1 text-xs text-foreground hover:bg-white/25 dark:hover:bg-white/10"
        >
          <ActivityIcon class="size-3.5 shrink-0 opacity-80" strokeWidth={1.75} />
          Activity
        </a>
        <a
          href={resolve("/api-keys")}
          class="flex items-center gap-2 rounded-sm px-3 py-1 text-xs text-foreground hover:bg-white/25 dark:hover:bg-white/10"
        >
          <KeyRound class="size-3.5 shrink-0 opacity-80" strokeWidth={1.75} />
          API Keys
        </a>
        <a
          href={resolve("/settings/agents")}
          class="flex items-center gap-2 rounded-sm px-3 py-1 text-xs text-foreground hover:bg-white/25 dark:hover:bg-white/10"
        >
          <Send class="size-3.5 shrink-0 opacity-80" strokeWidth={1.75} />
          Webhooks
        </a>
        <a
          href={resolve("/settings/llm")}
          class="flex items-center gap-2 rounded-sm px-3 py-1 text-xs text-foreground hover:bg-white/25 dark:hover:bg-white/10"
        >
          <Cpu class="size-3.5 shrink-0 opacity-80" strokeWidth={1.75} />
          Credits
        </a>
        {#if isAdmin}
          <a
            href={resolve("/admin/queue")}
            class="flex items-center gap-2 rounded-sm px-3 py-1 text-xs text-foreground hover:bg-white/25 dark:hover:bg-white/10"
          >
            <Layers class="size-3.5 shrink-0 opacity-80" strokeWidth={1.75} />
            Admin queue
          </a>
          <a
            href={resolve("/admin/spend")}
            class="flex items-center gap-2 rounded-sm px-3 py-1 text-xs text-foreground hover:bg-white/25 dark:hover:bg-white/10"
          >
            <BarChart3 class="size-3.5 shrink-0 opacity-80" strokeWidth={1.75} />
            Admin spend
          </a>
        {/if}
        {#if dev}
          <a
            href={resolve("/eval")}
            class="flex items-center gap-2 rounded-sm px-3 py-1 text-xs text-foreground hover:bg-white/25 dark:hover:bg-white/10"
          >
            <ClipboardCheck class="size-3.5 shrink-0 opacity-80" strokeWidth={1.75} />
            Evals
          </a>
        {/if}
        <a
          href={resolve("/settings/scheduled-tasks")}
          class="flex items-center gap-2 rounded-sm px-3 py-1 text-xs text-foreground hover:bg-white/25 dark:hover:bg-white/10"
        >
          <HeartPulse class="size-3.5 shrink-0 opacity-80" strokeWidth={1.75} />
          Heartbeat
        </a>
        <a
          href={resolve("/settings")}
          class="flex items-center gap-2 rounded-sm px-3 py-1 text-xs text-foreground hover:bg-white/25 dark:hover:bg-white/10"
        >
          <Settings class="size-3.5 shrink-0 opacity-80" strokeWidth={1.75} />
          Settings
        </a>
        {#if user?.email}
          <div class="mt-1 truncate border-t border-white/40 px-3 pt-3 text-xs text-muted-foreground dark:border-white/20">
            {user.email}
          </div>
        {/if}
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-full px-3 py-1 text-left text-xs text-red-600 hover:bg-red-500/15 dark:text-red-400 dark:hover:bg-red-950/30"
          onclick={() => void signOut()}
        >
          <LogOut class="size-3.5 shrink-0 opacity-80" strokeWidth={1.75} />
          Log out
        </button>
      </Popover.Content>
    </Popover.Root>
  </div>
</header>
