<script lang="ts">
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { cn } from "$lib/utils";
  import { activeMemorySurfaceTab } from "$lib/memory/memory-surface-nav";
  import { m } from "$lib/paraglide/messages.js";

  type MemoryTabPath = "/memory" | "/memory/timeline" | "/memory/notes";

  const tabs: Array<{
    id: "graph" | "embeddings" | "timeline" | "notes";
    label: () => string;
    pathname: MemoryTabPath;
    search?: string;
  }> = [
    { id: "graph", label: () => m.graph_tab_graph(), pathname: "/memory" },
    {
      id: "embeddings",
      label: () => m.graph_tab_embeddings(),
      pathname: "/memory",
      search: "view=embeddings",
    },
    {
      id: "timeline",
      label: () => m.graph_tab_timeline(),
      pathname: "/memory/timeline",
    },
    { id: "notes", label: () => m.memory_tab_notes(), pathname: "/memory/notes" },
  ];

  function tabHref(pathname: MemoryTabPath, search?: string): string {
    const base = resolve(pathname);
    return search ? `${base}?${search}` : base;
  }

  const activeTab = $derived(
    activeMemorySurfaceTab(page.url.pathname, page.url.searchParams.get("view")),
  );
</script>

<div
  class="pointer-events-none fixed inset-x-0 z-30 flex justify-center px-2 bottom-[calc(env(safe-area-inset-bottom,0px)+6rem)]"
  aria-label={m.memory_aria_view_tabs()}
>
  <nav
    class="bg-white/20 shadow-xl shadow-black/5 backdrop-blur-md brightness-105 dark:bg-card pointer-events-auto flex h-9 max-w-[calc(100vw-1rem)] shrink-0 items-stretch gap-1 overflow-x-auto rounded-full border border-white/80 p-0.5"
  >
    {#each tabs as tab (tab.id)}
      <a
        href={tabHref(tab.pathname, tab.search)}
        class={cn(
          "flex h-full items-center rounded-full px-3 text-xs whitespace-nowrap",
          activeTab === tab.id
            ? "bg-[#28F97F] text-black hover:text-black dark:bg-[#28F97F] dark:text-black dark:hover:text-black"
            : "text-black hover:text-black dark:text-foreground dark:hover:text-foreground",
        )}
        aria-current={activeTab === tab.id ? "page" : undefined}
      >
        {tab.label()}
      </a>
    {/each}
  </nav>
</div>
