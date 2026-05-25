<script lang="ts">
  import { onMount } from "svelte";
  import type { Pathname } from "$app/types";
  import { base, resolve } from "$app/paths";
  import { page } from "$app/state";
  import MessageSquareText from "@lucide/svelte/icons/message-square-text";
  import Network from "@lucide/svelte/icons/network";
  import Plus from "@lucide/svelte/icons/plus";
  import "./layout.css";
  import favicon from "$lib/assets/favicon.svg";
  import { cn } from "$lib/utils";
  import AppHeader from "$lib/components/app-header.svelte";
  import { startCaptureQueueRunner } from "$lib/capture/queue";

  let { children } = $props();

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

  /** Hide header + bottom nav on auth screens (works with `paths.base` and trailing slashes). */
  const hideAppChrome = $derived(
    page.route.id === "/login" ||
      page.route.id === "/signup" ||
      page.route.id === "/register" ||
      page.route.id === "/logo" ||
      normalizePathname(page.url.pathname) === "/login" ||
      normalizePathname(page.url.pathname) === "/signup" ||
      normalizePathname(page.url.pathname) === "/register" ||
      normalizePathname(page.url.pathname) === "/logo",
  );

  let currentPath = $derived(page.url.pathname);
  let themePreference = "system";

  const bottomNavItems = $derived([
    {
      label: "Graph",
      href: "/graph",
      icon: Network,
      active: currentPath.includes("/graph"),
      variant: "secondary",
    },
    {
      label: "Capture",
      href: "/capture",
      icon: Plus,
      active: currentPath.includes("/capture"),
      variant: "primary",
    },
    {
      label: "Chat",
      href: "/chat",
      icon: MessageSquareText,
      active: currentPath.includes("/chat"),
      variant: "secondary",
    },
  ]);

  onMount(() => {
    startCaptureQueueRunner();

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
      const meta = document.querySelector('meta[name="theme-color"]');
      if (!meta) return;
      const bg = getComputedStyle(document.documentElement)
        .getPropertyValue("--background")
        .trim();
      if (bg) meta.setAttribute("content", bg);
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

<div class="min-h-dvh bg-background" class:pb-28={!hideAppChrome} class:pb-6={hideAppChrome} class:pt-20={!hideAppChrome}>
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
    <div class="relative flex flex-row items-center gap-2 px-2 pb-safe">
      <div
        class="pointer-events-none bg-linear-to-t absolute -top-6 right-0 bottom-0 left-0 -z-10 w-full from-background to-transparent dark:from-black dark:to-black/0"
      ></div>
      {#each bottomNavItems as item}
        <div class={cn("relative", item.variant === "primary" ? "grow" : "")}>
          <a
            href={resolve(item.href as Pathname)}
            class={cn(
              "flex items-center justify-center rounded-full py-3",
              item.variant === "primary"
                ? "bg-primary text-primary-foreground shadow-md grow"
                : "px-6 text-foreground hover:bg-black/10 dark:text-white dark:hover:bg-white/10",
            )}
            aria-label={item.label}
          >
            <item.icon class="size-5" strokeWidth={1.75} />
          </a>
          {#if item.href === currentPath}
            <div class="absolute -bottom-2 flex h-0 w-full items-center justify-center">
              <div class="bg-foreground absolute size-2 rounded-full dark:bg-white"></div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </nav>
{/if}
