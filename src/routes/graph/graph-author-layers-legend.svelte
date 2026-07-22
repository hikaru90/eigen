<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import ChevronUp from '@lucide/svelte/icons/chevron-up'
  import AuthorLayerIcon from '$lib/components/author-layer-icon.svelte'
  import { graphFilterGlassPanelClass } from '$lib/graph/graph-filter-chrome'
  import type { AuthorLayerMeta } from '$lib/graph/graph-author-layers'
  import {
    authorAgentLegendIconFrameClass,
    authorLegendItemClassForLayer,
    authorLegendItemStateClass,
  } from '$lib/memory/author-layer-chrome'
  import { m } from '$lib/paraglide/messages.js'

  let {
    authorLayers = [],
    panelId = 'graph-author-layers-panel',
    visibleAuthorLayers = $bindable(new Set<string>()),
  }: {
    authorLayers?: AuthorLayerMeta[]
    panelId?: string
    visibleAuthorLayers?: Set<string>
  } = $props()

  const filterActive = $derived(visibleAuthorLayers.size > 0)
  const hasLayers = $derived(authorLayers.length > 0)
  let legendExpanded = $state(false)
  const legendPanelExpanded = $derived(legendExpanded && hasLayers)

  function toggleAuthorLayer(key: string) {
    const next = new Set(visibleAuthorLayers)
    if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
    }
    visibleAuthorLayers = next
  }

  function clearAuthorLayerFilter() {
    visibleAuthorLayers = new Set()
  }
</script>

{#if hasLayers}
  <aside
    class="{graphFilterGlassPanelClass(
      legendPanelExpanded,
    )} pointer-events-none flex w-full flex-col justify-start overflow-hidden {legendPanelExpanded
      ? 'max-h-56'
      : 'h-9'}"
    aria-label={m.graph_aria_author_layers()}
  >
    <div
      class="text-foreground pointer-events-auto flex min-h-0 w-full flex-col justify-start text-xs leading-none"
    >
      <div
        class="flex h-9 shrink-0 items-center justify-between gap-1 px-2 {legendPanelExpanded
          ? 'border-border/40 border-b'
          : ''}"
      >
        <button
          type="button"
          class="text-black hover:text-black/80 dark:text-foreground dark:hover:text-foreground focus-visible:ring-ring/50 flex h-7 min-w-0 flex-1 items-center gap-1 text-left transition-colors focus-visible:ring-1 focus-visible:outline-none"
          aria-expanded={legendExpanded}
          aria-controls={panelId}
          onclick={() => (legendExpanded = !legendExpanded)}
        >
          {#if legendExpanded}
            <ChevronUp class="size-3 shrink-0" strokeWidth={2} aria-hidden="true" />
          {:else}
            <ChevronDown class="size-3 shrink-0" strokeWidth={2} aria-hidden="true" />
          {/if}
          <span class="truncate text-xs font-semibold tracking-tight">{m.graph_authors()}</span>
          {#if filterActive}
            <span
              class="bg-black/10 text-foreground dark:bg-white/15 shrink-0 rounded-full px-1.5 font-mono text-[10px] tabular-nums"
            >
              {visibleAuthorLayers.size}
            </span>
          {/if}
        </button>
        <div class="flex shrink-0 items-center justify-end gap-1">
          {#if filterActive}
            <button
              type="button"
              class="text-foreground/80 hover:text-foreground focus-visible:ring-ring/50 h-7 shrink-0 rounded-full px-1.5 text-xs font-medium focus-visible:ring-1 focus-visible:outline-none"
              onclick={clearAuthorLayerFilter}
            >
              {m.graph_show_all()}
            </button>
          {/if}
        </div>
      </div>

      {#if legendPanelExpanded}
        <div id={panelId} class="min-h-0 flex-1 overflow-y-auto px-1 pt-1">
          <ul class="flex flex-col gap-1" role="list">
            {#each authorLayers as layer (layer.key)}
              {@const isSelected = filterActive && visibleAuthorLayers.has(layer.key)}
              <li class="min-w-0">
                <button
                  type="button"
                  class="{authorLegendItemClassForLayer(layer.kind)} {authorLegendItemStateClass({
                    filterActive,
                    isSelected,
                  })}"
                  title={layer.label}
                  aria-pressed={filterActive ? isSelected : false}
                  onclick={() => toggleAuthorLayer(layer.key)}
                >
                  {#if layer.kind === 'agent'}
                    <span class={authorAgentLegendIconFrameClass} aria-hidden="true">
                      <AuthorLayerIcon kind="agent" size="md" />
                    </span>
                  {:else}
                    <AuthorLayerIcon kind={layer.kind} size="md" />
                  {/if}
                  <span class="truncate font-medium">{layer.label}</span>
                </button>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  </aside>
{/if}
