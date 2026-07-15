<script lang="ts">
  import { onMount } from "svelte";
  import { browser } from "$app/environment";
  import { afterNavigate } from "$app/navigation";
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
  import { startPushNavigationFromServiceWorker } from "$lib/push/navigation-from-sw";
  import { startThoughtSync } from "$lib/stores/thought-sync";
  import { initCurrentUserViewStore } from "$lib/stores/current-user-view";
  import type { AuthorLayerMeta } from "$lib/graph/graph-author-layers";
  import { getLocale, setLocale } from "$lib/paraglide/runtime";
  import { m } from "$lib/paraglide/messages.js";
  import {
    isPostHogEnabled,
    identify,
    resetPostHog,
    capturePageview,
  } from "$lib/analytics/posthog-client";

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

  function isNavItemActive(href: string): boolean {
    const current = normalizePathname(page.url.pathname);
    const target = normalizePathname(href);
    if (current === target) return true;
    if (target === "/memory") return current.startsWith("/memory");
    if (target === "/chat") return current.startsWith("/chat");
    return current.startsWith(`${target}/`);
  }

  const hideAppChrome = $derived(
    authPaths.has(normalizePathname(page.url.pathname)) ||
      (page.route.id != null && authPaths.has(page.route.id)),
  );

  let themePreference = "system";

  const bottomNavItems = $derived([
    {
      label: m.nav_memory(),
      href: "/memory",
      icon: Brain,
      variant: "secondary" as const,
    },
    {
      label: m.nav_capture(),
      href: "/capture",
      icon: Plus,
      variant: "primary" as const,
    },
    {
      label: m.nav_chat(),
      href: "/chat",
      icon: MessageSquareText,
      variant: "secondary" as const,
    },
  ]);

  $effect(() => {
    if (!browser) return;
    const user = (page.data as { user?: { id: string; email?: string; name?: string } | null }).user;
    const isAdmin = (page.data as { isAdmin?: boolean }).isAdmin ?? false;
    if (user?.id) {
      identify(user.id, { email: user.email, name: user.name, is_admin: isAdmin });
    } else {
      resetPostHog();
    }
  });

  $effect(() => {
    if (!browser) return;
    const user = (page.data as { user?: { id: string } | null }).user;
    if (!user) return;
    const layers = (page.data as { authorLayers?: AuthorLayerMeta[] }).authorLayers ?? [];
    initCurrentUserViewStore(layers);
  });

  onMount(() => {
    const posthogReady = isPostHogEnabled();
    if (posthogReady) {
      const initialPath = normalizePathname(page.url.pathname);
      if (!authPaths.has(initialPath)) {
        capturePageview(initialPath);
      }
    }
    afterNavigate((nav) => {
      const path = normalizePathname(nav.to?.url.pathname ?? page.url.pathname);
      if (!authPaths.has(path)) {
        capturePageview(path);
      }
    });

    const stopPushNavigation = startPushNavigationFromServiceWorker();

    if ((page.data as { user?: { id: string } | null }).user) {
      startCaptureQueueRunner();
      startThoughtSync();
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
      stopPushNavigation();
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
    <div class="relative flex flex-row items-center justify-between gap-2 px-4 pb-safe">
      <div
        class="pointer-events-none absolute inset-x-0 -top-24 bottom-0 -z-10 bg-linear-to-t from-background to-transparent"
      ></div>
      {#each bottomNavItems as item}
        {@const isActive = isNavItemActive(item.href)}
        <div class={cn("relative", item.variant === "primary" ? "min-h-10 flex-1" : "shrink-0")}>
          <a
            href={resolve(item.href as Pathname)}
            class={cn(
              "flex items-center justify-center",
              item.variant === "primary"
                ? "w-full rounded-full bg-primary py-4 text-primary-foreground shadow-md"
                : "size-10 rounded-full bg-black text-white hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90",
            )}
            aria-label={item.label}
            aria-current={isActive ? "page" : undefined}
          >
            <item.icon
              class={cn("size-4.5", isActive && "text-[#28F97F]")}
              strokeWidth={1.75}
            />
          </a>
        </div>
      {/each}
    </div>
  </nav>
{/if}
