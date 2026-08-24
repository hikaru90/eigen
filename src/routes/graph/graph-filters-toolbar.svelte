<script lang="ts">
  import Link2 from '@lucide/svelte/icons/link-2'
  import ListFilterIcon from '@lucide/svelte/icons/list-filter'
  import SearchIcon from '@lucide/svelte/icons/search'
  import XIcon from '@lucide/svelte/icons/x'
  import { onDestroy } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import { browser } from '$app/environment'
  import { Input } from '$lib/components/ui/input'
  import { Label } from '$lib/components/ui/label'
  import * as Select from '$lib/components/ui/select'
  import { COMMUNITY_LEAF_LEVEL } from '$lib/graph/community-levels'
  import {
    GRAPH_FILTER_GLASS_ROW,
    graphFilterGlassPanelClass,
    graphFilterTriggerClass,
  } from '$lib/graph/graph-filter-chrome'
  import { graphCommunityLevelLabel, graphEdgeKindLabel } from '$lib/graph/graph-i18n'
  import { GRAPH_ONTOLOGY_ENTITY_KINDS_TITLE } from '$lib/graph/graph-i18n'
  import {
    entityKindKeyFromLegendItem,
    type GraphLegendSection,
  } from '$lib/graph/graph-ontology-legend'
  import { shouldSubmitSearchOnEnter } from '$lib/graph/graph-search-keyboard'
  import { m } from '$lib/paraglide/messages.js'

  type FilterPanel = 'search' | 'edge' | 'entity' | 'level'

  const MORPH_MS = 280

  let {
    search = $bindable(''),
    edgeKind = $bindable('all'),
    communityLevel = $bindable(String(COMMUNITY_LEAF_LEVEL)),
    availableCommunityLevels,
    legendSections = [],
    visibleEntityTypes = $bindable(new Set<string>()),
    onsubmit,
    onchange,
  }: {
    search?: string
    edgeKind?: string
    communityLevel?: string
    availableCommunityLevels: number[]
    legendSections?: GraphLegendSection[]
    visibleEntityTypes?: Set<string>
    onsubmit?: () => void
    onchange?: () => void
  } = $props()

  let toolbarEl = $state<HTMLDivElement | null>(null)
  let searchInputEl = $state<HTMLInputElement | null>(null)
  let filterOpen = $state(false)
  let activePanel = $state<FilterPanel | null>(null)
  let isFixed = $state(false)
  let anchorTop = $state(0)
  let anchorLeft = $state(0)
  let translateX = $state(0)
  let translateY = $state(0)
  let placeholderW = $state(0)
  let placeholderH = $state(0)
  let backdropBlurred = $state(false)

  const BACKDROP_BLUR_PX = 20

  let keydownHandler: ((e: KeyboardEvent) => void) | null = null
  let resizeHandler: (() => void) | null = null
  let blurRafId: number | null = null

  const backdropStyle = $derived(
    `-webkit-backdrop-filter: blur(${backdropBlurred ? BACKDROP_BLUR_PX : 0}px); backdrop-filter: blur(${backdropBlurred ? BACKDROP_BLUR_PX : 0}px); transition: backdrop-filter ${MORPH_MS}ms ease-out, -webkit-backdrop-filter ${MORPH_MS}ms ease-out; -webkit-mask-image: linear-gradient(to bottom, black 0%, black 25%, transparent 60%); mask-image: linear-gradient(to bottom, black 0%, black 25%, transparent 60%);`,
  )

  const searchFilterActive = $derived(search.trim().length > 0)
  const edgeFilterActive = $derived(edgeKind !== 'all')
  const levelFilterActive = $derived(communityLevel !== String(COMMUNITY_LEAF_LEVEL))
  const entityFilterActive = $derived(visibleEntityTypes.size > 0)

  const entityKindsSection = $derived(
    legendSections.find((s) => s.title === GRAPH_ONTOLOGY_ENTITY_KINDS_TITLE) ?? null,
  )
  const entityItems = $derived(entityKindsSection?.items ?? [])

  const shellClass = $derived(
    filterOpen
      ? `${graphFilterGlassPanelClass(true)} flex w-[min(18rem,calc(100vw-2rem))] flex-col shrink-0 items-stretch gap-0 p-0.5`
      : GRAPH_FILTER_GLASS_ROW,
  )

  const morphStyle = $derived(
    isFixed
      ? `top:${anchorTop}px;left:${anchorLeft}px;transform:translate(${translateX}px,${translateY}px);transition:transform ${MORPH_MS}ms ease-out,width ${MORPH_MS}ms ease-out;`
      : '',
  )

  function toggleEntityType(itemKey: string) {
    const kindKey = entityKindKeyFromLegendItem(itemKey)
    const next = new SvelteSet(visibleEntityTypes)
    if (next.has(kindKey)) {
      next.delete(kindKey)
    } else {
      next.add(kindKey)
    }
    visibleEntityTypes = next
    onchange?.()
  }

  function clearEntityTypeFilter() {
    visibleEntityTypes = new SvelteSet()
    onchange?.()
  }

  function setSearch(value: string) {
    search = value
    onchange?.()
  }

  function setEdgeKind(value: string) {
    edgeKind = value
    onchange?.()
  }

  function setCommunityLevel(value: string) {
    communityLevel = value
    onchange?.()
  }

  function computeOpenTransform(width: number) {
    if (!browser) return { x: 0, y: 0 }
    const targetX = (window.innerWidth - width) / 2
    return {
      x: targetX - anchorLeft,
      y: 0,
    }
  }

  function recenterModal() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = toolbarEl
        if (!el || !filterOpen) return
        const rect = el.getBoundingClientRect()
        const t = computeOpenTransform(rect.width)
        translateX = t.x
        translateY = t.y
      })
    })
  }

  function attachFilterWindowListeners() {
    if (!browser) return
    detachFilterWindowListeners()
    keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeFilter()
    }
    resizeHandler = () => recenterModal()
    window.addEventListener('keydown', keydownHandler)
    window.addEventListener('resize', resizeHandler)
    backdropBlurred = false
    blurRafId = requestAnimationFrame(() => {
      backdropBlurred = true
      blurRafId = null
    })
  }

  function detachFilterWindowListeners() {
    if (keydownHandler) {
      window.removeEventListener('keydown', keydownHandler)
      keydownHandler = null
    }
    if (resizeHandler) {
      window.removeEventListener('resize', resizeHandler)
      resizeHandler = null
    }
    if (blurRafId !== null) {
      cancelAnimationFrame(blurRafId)
      blurRafId = null
    }
    backdropBlurred = false
  }

  function openFilter(panel: FilterPanel) {
    const el = toolbarEl
    if (!el || !browser) return
    const rect = el.getBoundingClientRect()
    placeholderW = rect.width
    placeholderH = rect.height
    anchorTop = rect.top
    anchorLeft = rect.left
    translateX = 0
    translateY = 0
    isFixed = true
    activePanel = panel
    filterOpen = true
    attachFilterWindowListeners()
    recenterModal()
    if (panel === 'search') {
      queueMicrotask(() => searchInputEl?.focus())
    }
  }

  function closeFilter() {
    detachFilterWindowListeners()
    translateX = 0
    translateY = 0
    filterOpen = false
    setTimeout(() => {
      activePanel = null
      isFixed = false
    }, MORPH_MS)
  }

  function onIconClick(panel: FilterPanel) {
    if (filterOpen && activePanel === panel) {
      closeFilter()
      return
    }
    if (filterOpen) {
      activePanel = panel
      if (panel === 'search') {
        queueMicrotask(() => searchInputEl?.focus())
      }
      recenterModal()
      return
    }
    openFilter(panel)
  }

  onDestroy(() => {
    detachFilterWindowListeners()
  })
</script>

{#if isFixed}
  <button
    type="button"
    class="fixed inset-0 z-40 bg-transparent"
    style={backdropStyle}
    aria-label={m.graph_close()}
    onclick={closeFilter}
  ></button>
{/if}

<div
  class="relative shrink-0"
  style:width={isFixed ? `${placeholderW}px` : undefined}
  style:min-height={isFixed ? `${placeholderH}px` : undefined}
>
  <div
    bind:this={toolbarEl}
    class="{shellClass} {isFixed ? 'fixed z-50' : 'relative'} pointer-events-auto"
    style={morphStyle}
    role="dialog"
    aria-modal={filterOpen}
    aria-label={m.graph_aria_legend_filters()}
  >
    <div
      class="flex shrink-0 gap-0.5 {filterOpen
        ? 'flex-row items-center justify-center'
        : 'flex-col items-end'}"
    >
      {#if searchFilterActive && !filterOpen}
        <button
          type="button"
          class="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-destructive/20 text-destructive transition-colors hover:bg-destructive/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50 dark:bg-destructive/30 dark:hover:bg-destructive/40"
          onclick={() => {
            setSearch('')
          }}
          aria-label="Clear search filter"
        >
          <XIcon class="size-3" strokeWidth={2} aria-hidden="true" />
        </button>
      {/if}
      <button
        type="button"
        class={graphFilterTriggerClass(
          searchFilterActive || (filterOpen && activePanel === 'search'),
        )}
        aria-label={m.graph_search_nodes()}
        aria-expanded={filterOpen && activePanel === 'search'}
        aria-pressed={filterOpen && activePanel === 'search'}
        onclick={() => onIconClick('search')}
      >
        <SearchIcon class="size-3 shrink-0 opacity-90" strokeWidth={1.75} aria-hidden="true" />
      </button>
      <button
        type="button"
        class={graphFilterTriggerClass(edgeFilterActive || (filterOpen && activePanel === 'edge'))}
        aria-label={m.graph_aria_edge_filter()}
        aria-expanded={filterOpen && activePanel === 'edge'}
        aria-pressed={filterOpen && activePanel === 'edge'}
        onclick={() => onIconClick('edge')}
      >
        <Link2 class="size-3 shrink-0 opacity-90" strokeWidth={1.75} aria-hidden="true" />
      </button>
      <button
        type="button"
        class={graphFilterTriggerClass(
          entityFilterActive || (filterOpen && activePanel === 'entity'),
        )}
        aria-label={m.graph_aria_entity_type_filter()}
        aria-expanded={filterOpen && activePanel === 'entity'}
        aria-pressed={filterOpen && activePanel === 'entity'}
        onclick={() => onIconClick('entity')}
      >
        <ListFilterIcon class="size-3 shrink-0 opacity-90" strokeWidth={1.75} aria-hidden="true" />
      </button>
      <button
        type="button"
        class={graphFilterTriggerClass(
          levelFilterActive || (filterOpen && activePanel === 'level'),
        )}
        aria-label={m.graph_aria_community_level()}
        aria-expanded={filterOpen && activePanel === 'level'}
        aria-pressed={filterOpen && activePanel === 'level'}
        onclick={() => onIconClick('level')}
      >
        <span class="text-[10px] font-semibold leading-none">L</span>
      </button>
    </div>

    {#if filterOpen && activePanel}
      <div class="border-border/40 flex min-h-0 flex-col gap-2 border-t p-3">
        {#if activePanel === 'search'}
          <Label for="graph-search" class="text-xs">{m.graph_search_nodes()}</Label>
          <Input
            bind:ref={searchInputEl}
            id="graph-search"
            class="font-mono text-xs"
            placeholder={m.graph_search_placeholder()}
            value={search}
            oninput={(e: Event) => {
              const t = e.currentTarget as HTMLInputElement
              setSearch(t.value)
            }}
            onkeydown={(e: KeyboardEvent) => {
              if (shouldSubmitSearchOnEnter(e)) {
                e.preventDefault()
                onsubmit?.()
                closeFilter()
              }
            }}
          />
        {:else if activePanel === 'edge'}
          <Label class="text-xs">{m.graph_edge_type()}</Label>
          <Select.Root
            type="single"
            value={edgeKind}
            onValueChange={(v) => {
              if (v !== undefined) setEdgeKind(v)
            }}
          >
            <Select.Trigger class="w-full font-mono text-xs">
              {graphEdgeKindLabel(edgeKind)}
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="all">{m.graph_edge_all()}</Select.Item>
              <Select.Item value="co_mention">{m.graph_edge_co_mention()}</Select.Item>
              <Select.Item value="entity_relation">{m.graph_edge_relations()}</Select.Item>
            </Select.Content>
          </Select.Root>
        {:else if activePanel === 'entity'}
          <div class="flex items-center justify-between">
            <Label class="text-xs">{m.graph_filter()}</Label>
            {#if entityFilterActive}
              <button
                type="button"
                class="text-muted-foreground hover:text-foreground text-xs"
                onclick={clearEntityTypeFilter}
              >
                {m.graph_show_all()}
              </button>
            {/if}
          </div>
          <div class="flex flex-wrap gap-1.5">
            {#each entityItems as item (item.key)}
              {@const kindKey = entityKindKeyFromLegendItem(item.key)}
              {@const isSelected = entityFilterActive && visibleEntityTypes.has(kindKey)}
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs transition-colors {isSelected
                  ? 'border-black text-black dark:border-white dark:text-white'
                  : 'border-border/60 text-foreground hover:bg-muted/40'} {entityFilterActive &&
                !isSelected
                  ? 'opacity-40'
                  : ''}"
                title={item.hint}
                aria-pressed={entityFilterActive ? isSelected : false}
                onclick={() => toggleEntityType(item.key)}
              >
                {#if item.fill}
                  <span
                    class="size-2 shrink-0 rounded-full ring-1 ring-border/60"
                    style="background-color: {item.fill}"
                    aria-hidden="true"
                  ></span>
                {/if}
                <span class="font-medium">{item.label}</span>
              </button>
            {/each}
          </div>
        {:else if activePanel === 'level'}
          <Label class="text-xs">{m.graph_community_level()}</Label>
          <Select.Root
            type="single"
            value={communityLevel}
            onValueChange={(v) => {
              if (v !== undefined) setCommunityLevel(v)
            }}
          >
            <Select.Trigger class="w-full font-mono text-xs">
              {graphCommunityLevelLabel(Number.parseInt(communityLevel, 10))}
            </Select.Trigger>
            <Select.Content>
              {#each availableCommunityLevels as level (level)}
                <Select.Item value={String(level)}>{graphCommunityLevelLabel(level)}</Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        {/if}
      </div>
    {/if}
  </div>
</div>
