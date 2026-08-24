<script lang="ts">
  import { resolve } from '$app/paths'
  import { page } from '$app/state'
  import type { Pathname } from '$app/types'
  import { activeMemorySurfaceTab } from '$lib/memory/memory-surface-nav'
  import { m } from '$lib/paraglide/messages.js'
  import { cn } from '$lib/utils'

  type MemoryTabPath = '/memory' | '/memory/tasks' | '/memory/projects' | '/memory/notes'

  const tabs: Array<{
    id: 'graph' | 'embeddings' | 'tasks' | 'projects' | 'notes'
    label: () => string
    pathname: MemoryTabPath
    search?: string
  }> = [
    { id: 'graph', label: () => m.graph_tab_graph(), pathname: '/memory' },
    {
      id: 'embeddings',
      label: () => m.graph_tab_embeddings(),
      pathname: '/memory',
      search: 'view=embeddings',
    },
    {
      id: 'tasks',
      label: () => m.memory_tab_tasks(),
      pathname: '/memory/tasks',
    },
    {
      id: 'projects',
      label: () => m.memory_tab_projects(),
      pathname: '/memory/projects',
    },
    { id: 'notes', label: () => m.memory_tab_notes(), pathname: '/memory/notes' },
  ]

  const activeTab = $derived(
    activeMemorySurfaceTab(page.url.pathname, page.url.searchParams.get('view')),
  )
</script>

<div
  class="pointer-events-none fixed inset-x-0 z-30 flex justify-center px-2 bottom-[calc(env(safe-area-inset-bottom,0px)+6rem)]"
  aria-label={m.memory_aria_view_tabs()}
>
  <nav
    class="pointer-events-auto flex h-9 max-w-[calc(100vw-1rem)] shrink-0 items-stretch gap-0.5 overflow-x-auto rounded-full border border-white/80 bg-white/20 p-0.5 shadow-xl shadow-black/5 backdrop-blur-md brightness-105 dark:border-white/15 dark:bg-black/45 dark:backdrop-blur-xl dark:brightness-100"
  >
    {#each tabs as tab (tab.id)}
      <a
        href={tab.search
          ? resolve(`${tab.pathname}?${tab.search}` as Pathname)
          : resolve(tab.pathname)}
        class={cn(
          'flex h-full items-center rounded-full px-2 text-xs whitespace-nowrap',
          activeTab === tab.id
            ? 'bg-[var(--color-eigen-green)] text-black hover:text-black dark:bg-[var(--color-eigen-green)] dark:text-black dark:hover:text-black'
            : 'text-black hover:text-black dark:text-foreground dark:hover:text-foreground',
        )}
        aria-current={activeTab === tab.id ? 'page' : undefined}
      >
        {tab.label()}
      </a>
    {/each}
  </nav>
</div>
