<script lang="ts">
  import ListFilterIcon from '@lucide/svelte/icons/list-filter'
  import { SvelteSet } from 'svelte/reactivity'
  import {
    graphFilterGlassPanelClass,
    graphFilterTriggerClass,
  } from '$lib/graph/graph-filter-chrome'
  import { GRAPH_ONTOLOGY_ENTITY_KINDS_TITLE } from '$lib/graph/graph-i18n'
  import {
    entityKindKeyFromLegendItem,
    type GraphLegendSection,
  } from '$lib/graph/graph-ontology-legend'
  import { m } from '$lib/paraglide/messages.js'

  let {
    legendSections,
    graphStats = '',
    panelId = 'graph-legend-panel',
    visibleEntityTypes = $bindable(new Set<string>()),
    onchange,
  }: {
    legendSections: GraphLegendSection[]
    graphStats?: string
    panelId?: string
    visibleEntityTypes?: Set<string>
    onchange?: () => void
  } = $props()

  const entityKindsSection = $derived(
    legendSections.find((s) => s.title === GRAPH_ONTOLOGY_ENTITY_KINDS_TITLE) ?? null,
  )

  const entityItems = $derived(entityKindsSection?.items ?? [])
  const hasEntities = $derived(entityItems.length > 0)
  const showLegend = $derived(hasEntities || graphStats.trim().length > 0)
  const filterActive = $derived(visibleEntityTypes.size > 0)

  let legendExpanded = $state(false)

  const legendPanelExpanded = $derived(
    legendExpanded && (hasEntities || graphStats.trim().length > 0),
  )

  const shellClass = $derived(
    `${graphFilterGlassPanelClass(legendPanelExpanded)} pointer-events-auto flex flex-col gap-0.5 overflow-hidden p-0.5 ${
      legendPanelExpanded ? 'w-full max-w-[min(calc(100vw-1.5rem),11rem)] max-h-56' : 'w-fit'
    }`,
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
</script>

{#if showLegend}
  <aside class={shellClass} aria-label={m.graph_aria_entity_type_filter()}>
    <div
      class="flex h-7 shrink-0 items-center gap-1 {legendPanelExpanded
        ? 'border-border/40 w-full border-b'
        : ''}"
    >
      <button
        type="button"
        class="{graphFilterTriggerClass(false, 'label')} min-w-0 {legendPanelExpanded
          ? 'flex-1'
          : ''}"
        aria-expanded={legendExpanded}
        aria-controls={panelId}
        onclick={() => (legendExpanded = !legendExpanded)}
      >
        <ListFilterIcon
          class="size-2.5 shrink-0 opacity-90"
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <span class="truncate">{m.graph_filter()}</span>
        {#if filterActive}
          <span class="shrink-0 font-mono text-[10px] tabular-nums opacity-80">
            {visibleEntityTypes.size}
          </span>
        {/if}
      </button>
      {#if legendPanelExpanded && filterActive}
        <button
          type="button"
          class="text-foreground/80 hover:text-foreground focus-visible:ring-ring/50 shrink-0 rounded-full px-1.5 text-xs font-medium focus-visible:ring-1 focus-visible:outline-none"
          onclick={clearEntityTypeFilter}
        >
          {m.graph_show_all()}
        </button>
      {/if}
    </div>

    {#if legendPanelExpanded}
      <div id={panelId} class="flex min-h-0 flex-1 flex-col overflow-hidden">
        {#if hasEntities}
          <div class="min-h-0 flex-1 overflow-y-auto">
            <ul class="flex flex-col gap-1" role="list">
              {#each entityItems as item (item.key)}
                {@const kindKey = entityKindKeyFromLegendItem(item.key)}
                {@const isSelected = filterActive && visibleEntityTypes.has(kindKey)}
                <li class="min-w-0">
                  <button
                    type="button"
                    class="border-border/60 bg-muted/25 text-foreground hover:bg-muted/40 focus-visible:ring-ring/50 inline-flex w-full min-w-0 items-center gap-1.5 rounded-full border px-2 py-1 text-left text-xs transition-colors focus-visible:ring-1 focus-visible:outline-none {filterActive &&
                    !isSelected
                      ? 'opacity-40'
                      : ''} {isSelected
                      ? 'border-black text-black dark:border-white dark:text-white'
                      : ''}"
                    title={item.hint}
                    aria-pressed={filterActive ? isSelected : false}
                    onclick={() => toggleEntityType(item.key)}
                  >
                    {#if item.fill}
                      <span
                        class="size-2.5 shrink-0 rounded-full ring-1 ring-border/60"
                        style="background-color: {item.fill}"
                        aria-hidden="true"
                      ></span>
                    {/if}
                    <span class="truncate font-medium">{item.label}</span>
                  </button>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
        {#if graphStats}
          <p
            data-testid="graph-stats"
            class="text-muted-foreground border-border/40 shrink-0 border-t px-1 py-1 font-mono text-[10px] leading-tight tabular-nums"
          >
            {graphStats}
          </p>
        {/if}
      </div>
    {/if}
  </aside>
{/if}
