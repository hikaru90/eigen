<script lang="ts">
  import { resolve } from '$app/paths'
  import { page } from '$app/state'
  import { activeMemorySurfaceTab } from '$lib/memory/memory-surface-nav'
  import { m } from '$lib/paraglide/messages.js'
  import { cn } from '$lib/utils'

  type MemoryTabPath = '/desk' | '/memory' | '/memory/tasks' | '/memory/projects' | '/memory/notes'

  const tabs: Array<{
    id: 'desk' | 'graph' | 'embeddings' | 'tasks' | 'projects' | 'notes'
    label: () => string
    pathname: MemoryTabPath
    search?: string
  }> = [
    { id: 'desk', label: () => m.desk_tab_desk(), pathname: '/desk' },
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
    class="pointer-events-auto flex max-w-[calc(100vw-2rem)] shrink-0 items-stretch overflow-x-auto rounded-full bg-paper-2 p-[3px]"
  >
    {#each tabs as tab (tab.id)}
      <a
        href={tab.search
          ? resolve(`${tab.pathname}?${tab.search}` as MemoryTabPath)
          : resolve(tab.pathname)}
        class={cn(
          'flex items-center rounded-full px-3.5 py-1 text-sm whitespace-nowrap no-underline transition-colors duration-[450ms] ease-settle',
          activeTab === tab.id
            ? 'bg-raised text-ink shadow-(--pill-ring)'
            : 'text-ink-3 pointer-fine:hover:text-ink-2',
        )}
        aria-current={activeTab === tab.id ? 'page' : undefined}
      >
        {tab.label()}
      </a>
    {/each}
  </nav>
</div>
