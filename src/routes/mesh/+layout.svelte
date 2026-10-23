<script lang="ts">
  import { onMount } from 'svelte'
  import { base, resolve } from '$app/paths'
  import { page } from '$app/state'
  import {
    closeMeshSearch,
    meshSearch,
    openMeshSearch,
    setMeshSearchQuery,
  } from '$lib/mesh/mesh-search.svelte'
  import { m } from '$lib/paraglide/messages.js'

  let { children } = $props()

  /**
   * The Mesh page frame (ei redesign, wave 2.2): the floating tab row —
   * Yarn / Threads / Patterns as the ei tab group (ei styles.css .lens:
   * recessed --paper-2 track, raised pill sliding between choices) — plus the
   * round search button at the row's end that opens the in-track filter field
   * (ei styles.css .search). Threads and Patterns routes arrive in wave 3;
   * the entries exist from now on. Under the tabs, the one masked container
   * is the app chrome's; this layout only renders the routed page.
   */

  /* route ids, not pre-built paths: `resolve()` in the markup applies `base` and keeps the literal types */
  const tabs = [
    { id: 'yarn', href: '/mesh/yarn', label: m.mesh_tabs_yarn },
    { id: 'threads', href: '/mesh/threads', label: m.mesh_tabs_threads },
    { id: 'patterns', href: '/mesh/patterns', label: m.mesh_tabs_patterns },
  ] as const

  type TabId = (typeof tabs)[number]['id']

  /** ei app.js:196 — which tab a mesh pathname shows (default: Yarn). */
  const activeTab = $derived.by<TabId>(() => {
    let p: string = page.url.pathname
    if (base && p.startsWith(base)) p = p.slice(base.length) || '/'
    if (p.startsWith('/mesh/threads')) return 'threads'
    if (p.startsWith('/mesh/patterns')) return 'patterns'
    return 'yarn'
  })

  onMount(() => {
    return () => {
      closeMeshSearch()
    }
  })

  function closeSearch(): void {
    closeMeshSearch()
  }
</script>

<!-- The tab row is in flow: it scrolls with its section and sticks just below the
     header's fade band while the strand moves (no portal, no fixed positioning). -->
<div
  class="sticky top-[calc(var(--head,68px)+12px)] z-30 mx-auto mt-[calc(var(--head,68px)+12px)] flex w-fit items-center gap-2 px-1.5 pt-2 pb-3.5 max-w-[calc(100vw-44px)] bg-[linear-gradient(var(--paper)_55%,transparent)]"
>
  <nav
    class={`relative flex rounded-full bg-paper-2 p-[3px] ${meshSearch.open ? 'max-[640px]:hidden' : ''}`}
    aria-label={m.nav_mesh()}
  >
    {#each tabs as tab (tab.id)}
      <a
        href={resolve(tab.href)}
        class={[
          'relative rounded-full px-3.5 py-1 text-sm text-ink-3 no-underline transition-[color,background-color] duration-[450ms] ease-settle max-[640px]:px-[11px] pointer-fine:hover:text-ink-2',
          activeTab === tab.id ? 'text-ink bg-raised shadow-(--pill-ring)' : '',
        ]}
        aria-current={activeTab === tab.id ? 'page' : undefined}
      >
        {tab.label()}
      </a>
    {/each}
  </nav>

  <!-- Search: behind a small button at the row's end; open, it filters the list as you type. -->
  <div
    class={[
      'relative flex h-[33px] items-center rounded-full bg-paper-2',
      meshSearch.open ? 'pr-0.5 max-[640px]:w-[calc(100vw-44px)]' : '',
    ]}
  >
    <button
      class="grid size-[33px] place-items-center rounded-full text-ink-2 transition-colors duration-300 ease-settle pointer-fine:hover:text-ink"
      class:pointer-events-none={meshSearch.open}
      type="button"
      aria-label={m.yarn_search()}
      onclick={openMeshSearch}
    >
      <svg
        class="size-3.5 fill-none stroke-current [stroke-width:1.4] [stroke-linecap:round]"
        viewBox="0 0 16 16"
        aria-hidden="true"
      >
        <circle cx="7" cy="7" r="4.2" />
        <path d="m10.2 10.2 3.3 3.3" />
      </svg>
    </button>
    <input
      class={[
        'w-0 border-0 bg-transparent p-0 text-sm text-ink caret-signal outline-none opacity-0 placeholder:text-ink-3 [transition:width_0.5s_var(--ease),opacity_0.3s_var(--ease)] [&::-webkit-search-cancel-button]:hidden',
        meshSearch.open ? 'w-[170px] opacity-100 max-[640px]:flex-1 max-[640px]:w-auto' : '',
      ]}
      type="search"
      placeholder={m.yarn_search()}
      aria-label={m.yarn_search()}
      autocomplete="off"
      spellcheck="false"
      value={meshSearch.query}
      oninput={(e) => setMeshSearchQuery(e.currentTarget.value)}
      onkeydown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          closeSearch()
        }
      }}
    />
    <button
      class={[
        'w-[30px] h-[33px] place-items-center text-ink-3 pointer-fine:hover:text-ink',
        meshSearch.open ? 'grid' : 'hidden',
      ]}
      type="button"
      aria-label={m.graph_close()}
      onclick={closeSearch}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
      </svg>
    </button>
  </div>
</div>

<!-- tab switches animate through the root layout's view transition (the `page` snapshot);
     a keyed in/out swap here would stack old and new views in flow and jump on removal -->
<div class="lens-view min-h-[calc(100%-var(--head,68px)-44px)]">
  {@render children?.()}
</div>
