<script lang="ts">
  import { onMount } from "svelte";
  import { browser } from "$app/environment";
  import type { Pathname } from "$app/types";
  import { base, resolve } from "$app/paths";
  import { page } from "$app/state";
  import MessageSquareText from "@lucide/svelte/icons/message-square-text";
  import Brain from "@lucide/svelte/icons/brain";
  import Plus from "@lucide/svelte/icons/plus";
  import "./layout.css";
  import favicon from "$lib/assets/favicon.png";
  import { cn } from "$lib/utils";
  import AppHeader from "$lib/components/app-header.svelte";
  import { startCaptureQueueRunner } from "$lib/capture/queue";
  import { getLocale, setLocale } from "$lib/paraglide/runtime";
  import { m } from "$lib/paraglide/messages.js";

  let { children } = $props();

  const authPaths = new Set(["/login", "/signup", "/register"]);

  function normalizePathname(pathname: string): string {
    let p = pathname;
    if (base && p.startsWith(base)) {
      p = p.slice(base.length) || "/";
    }
    if (p.length > 1 && p.endsWith("/")) {
      p = p.slice(0, -1);
    }
    return p || "/";
  }

  const hideAppChrome = $derived(
    authPaths.has(normalizePathname(page.url.pathname)) ||
      (page.route.id != null && authPaths.has(page.route.id)),
  );

  let currentPath = $derived(page.url.pathname);
  let themePreference = "system";

  const bottomNavItems = $derived([
    {
      label: m.nav_memory(),
      href: "/memory",
      icon: Brain,
      active: currentPath.includes("/memory"),
      variant: "secondary" as const,
    },
    {
      label: m.nav_capture(),
      href: "/capture",
      icon: Plus,
      active: currentPath.includes("/capture"),
      variant: "primary" as const,
    },
    {
      label: m.nav_chat(),
      href: "/chat",
      icon: MessageSquareText,
      active: currentPath.includes("/chat"),
      variant: "secondary" as const,
    },
  ]);

  onMount(() => {
    if ((page.data as { user?: { id: string } | null }).user) {
      startCaptureQueueRunner();
    }

    const preferredUiLocale = (page.data as { preferredUiLocale?: string | null }).preferredUiLocale;
    if (preferredUiLocale && getLocale() !== preferredUiLocale) {
      setLocale(preferredUiLocale as "en" | "de");
    }

    void (async () => {
      try {
        const { pwaInfo } = await import("virtual:pwa-info");
        if (!pwaInfo) return;
        const { registerSW } = await import("virtual:pwa-register");
        registerSW({ immediate: true });
      } catch {
        /* PWA plugin unavailable (e.g. test env) */
      }
    })();

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncThemeColorMeta = () => {
      const meta = document.getElementById("theme-color-meta");
      if (!meta) return;
      const themeColor = getComputedStyle(document.documentElement)
        .getPropertyValue("--theme-color")
        .trim();
      if (themeColor) meta.setAttribute("content", themeColor);
    };

    const applyTheme = (isDark: boolean) => {
      document.documentElement.classList.toggle("dark", isDark);
      document.documentElement.style.colorScheme = isDark ? "dark" : "light";
      syncThemeColorMeta();
    };
    const applyThemePreference = (preference: string) => {
      themePreference = preference;
      const useDark = preference === "dark" || (preference === "system" && media.matches);
      applyTheme(useDark);
    };
    const savedPreference = localStorage.getItem("theme-preference") ?? "system";
    applyThemePreference(savedPreference);

    const handleChange = (event: MediaQueryListEvent) => {
      if (themePreference === "system") {
        applyTheme(event.matches);
      }
    };
    const handlePreferenceChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ preference?: string }>;
      applyThemePreference(customEvent.detail?.preference ?? "system");
    };
    media.addEventListener("change", handleChange);
    window.addEventListener("theme-preference-change", handlePreferenceChange);
    return () => {
      media.removeEventListener("change", handleChange);
      window.removeEventListener("theme-preference-change", handlePreferenceChange);
    };
  });
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<div class="bg-background min-h-dvh" class:pb-28={!hideAppChrome} class:pb-6={hideAppChrome}>
  {#if !hideAppChrome}
    <AppHeader />
  {/if}
  {@render children()}
</div>

{#if !hideAppChrome}
  <nav
    class="fixed bottom-0 left-0 right-0 z-20 text-foreground dark:text-white"
    aria-label="Main navigation"
  >
    <div class="relative flex flex-row items-center gap-1 px-1.5 pb-safe">
      <div
        class="pointer-events-none absolute inset-x-0 -top-24 bottom-0 -z-10 bg-linear-to-t from-background to-transparent"
      ></div>
      {#each bottomNavItems as item}
        <div class={cn("relative", item.variant === "primary" ? "grow" : "")}>
          <a
            href={resolve(item.href as Pathname)}
            class={cn(
              "flex items-center justify-center rounded-full py-3",
              item.variant === "primary"
                ? "bg-primary text-primary-foreground shadow-md grow"
                : "px-3 text-foreground hover:bg-black/10 dark:text-white dark:hover:bg-white/10",
            )}
            aria-label={item.label}
          >
            <item.icon class="size-5" strokeWidth={1.75} />
          </a>
          {#if item.active}
            <div class="absolute -bottom-2 flex h-0 w-full items-center justify-center">
              <div class="bg-foreground absolute size-2 rounded-full dark:bg-white"></div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </nav>
{/if}
