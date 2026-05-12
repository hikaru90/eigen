<script lang="ts">
  import { base, resolve } from "$app/paths";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import EigenWordmark from "$lib/components/eigen-wordmark.svelte";
  import * as Popover from "$lib/components/ui/popover";
  import ActivityIcon from "@lucide/svelte/icons/activity";
  import UserRound from "@lucide/svelte/icons/user-round";
  import Network from "@lucide/svelte/icons/network";

  let menuOpen = $state(false);
  const user = $derived(
    (page.data as { user?: { email?: string | null; name?: string | null } }).user ?? null,
  );
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
    await goto(resolve("/login"), { invalidateAll: true });
  }
</script>

<header class="w-full px-5 pt-6">
  <div class="mx-auto flex w-full items-center justify-between">
    <div class="w-10"></div>
    <EigenWordmark heightClass="h-10" />
    <Popover.Root bind:open={menuOpen}>
      <div>
        <Popover.Trigger
          class="relative block flex size-8 cursor-pointer items-center justify-center overflow-hidden rounded-full text-white"
          aria-label="Account menu"
        >
          <UserRound
            class="pointer-events-none relative z-10 size-5 shrink-0 text-black"
            aria-hidden="true"
          />
        </Popover.Trigger>
      </div>
      <Popover.Content
        align="end"
        side="bottom"
        sideOffset={8}
        class="w-44 rounded-md border border-black/10 bg-card p-1 shadow-md dark:border-white/20"
      >
        <a
          href={resolve("/activity")}
          class="flex items-center gap-2 rounded-sm px-3 py-2 text-xs text-foreground hover:bg-black/5 dark:hover:bg-white/10"
        >
          <ActivityIcon class="size-3.5 shrink-0 opacity-80" strokeWidth={1.75} />
          Activity
        </a>
        <a
          href={resolve("/graph")}
          class="flex items-center gap-2 rounded-sm px-3 py-2 text-xs text-foreground hover:bg-black/5 dark:hover:bg-white/10"
        >
          <Network class="size-3.5 shrink-0 opacity-80" strokeWidth={1.75} />
          Graph
        </a>
        <a
          href={resolve("/settings")}
          class="block rounded-sm px-3 py-2 text-xs text-foreground hover:bg-black/5 dark:hover:bg-white/10"
        >
          Account settings
        </a>
        <button
          type="button"
          class="block w-full rounded-sm px-3 py-2 text-left text-xs text-foreground hover:bg-black/5 dark:hover:bg-white/10"
          onclick={() => void signOut()}
        >
          Log out
        </button>
      </Popover.Content>
    </Popover.Root>
  </div>
</header>
