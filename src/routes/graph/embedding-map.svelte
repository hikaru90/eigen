<script lang="ts">
  import type { EmbeddingSnapshotItem } from '../api/embeddings/snapshot/+server'
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle'
  import { onMount, tick } from 'svelte'
  import {
    ensureEmbeddingProjection,
    subscribeEmbeddingProjection,
    type EmbeddingProjectionPhase,
  } from '$lib/graph/embedding-map-projection'
  import { filterNodesByAuthorLayers } from '$lib/graph/graph-author-layers'
  import {
    customEntityFillsFromLegendSections,
    filterNodesByEntityTypes,
    nodeFillForGraph,
    type GraphLegendSection,
  } from '$lib/graph/graph-ontology-legend'
  import { m } from '$lib/paraglide/messages.js'
  import { createEmbeddingMap3d, type EmbeddingMap3dHandle } from './embedding-map-3d'
  import GraphEntityKindsLegend from './graph-entity-kinds-legend.svelte'

  export type EmbeddingMapApi = {
    setSelectedId: (id: string | null) => void
    setVisibleSubtypes: (types: Set<string>) => void
    setVisibleAuthorLayers: (layers: Set<string>) => void
    resize: () => void
    remount: () => void
  }

  type Props = {
    graphLegendSections: GraphLegendSection[]
    visibleEntityTypes?: Set<string>
    visibleAuthorLayers?: Set<string>
    /** When false the tab panel is hidden — resize only; projection is prefetched at /memory layout. */
    visible?: boolean
    onSelectItem?: (item: EmbeddingSnapshotItem | null) => void
    selectedItemId?: string | null
    api?: EmbeddingMapApi | null
    /** Fired when the in-map entity-type legend changes shared filters. */
    onFiltersChanged?: () => void
  }

  let {
    graphLegendSections,
    visibleEntityTypes = $bindable(new Set<string>()),
    visibleAuthorLayers = $bindable(new Set<string>()),
    visible = true,
    onSelectItem,
    selectedItemId = null,
    // eslint-disable-next-line no-useless-assignment -- Svelte bindable prop
    api = $bindable<EmbeddingMapApi | null>(),
    onFiltersChanged,
  }: Props = $props()

  let phase = $state<EmbeddingProjectionPhase>({ kind: 'idle' })
  let rootEl: HTMLDivElement | undefined
  let snapshotItems = $state<EmbeddingSnapshotItem[]>([])

  const embeddingStats = $derived.by(() => {
    if (phase.kind !== 'ready' || snapshotItems.length === 0) return ''
    const filtered = filterNodesByAuthorLayers(
      filterNodesByEntityTypes(snapshotItems, visibleEntityTypes),
      visibleAuthorLayers,
    )
    const thoughtCount = filtered.filter((item) => item.kind === 'Thought').length
    const entityCount = filtered.filter((item) => item.kind === 'Entity').length
    return m.graph_embedding_stats({ thoughts: thoughtCount, entities: entityCount })
  })

  let teardown: (() => void) | undefined
  let mapHandle: EmbeddingMap3dHandle | null = null
  let mountedProjectionRevision: string | null = null
  let mountGeneration = 0

  function disposeMap() {
    teardown?.()
    teardown = undefined
    mapHandle?.dispose()
    mapHandle = null
  }

  async function mountMap() {
    if (phase.kind !== 'ready' || !rootEl) return
    if (mountedProjectionRevision === phase.revision && mapHandle) return

    const generation = ++mountGeneration
    disposeMap()

    await tick()
    if (generation !== mountGeneration || !rootEl || phase.kind !== 'ready') return

    const customFills = customEntityFillsFromLegendSections(graphLegendSections)
    const { items, coords, revision } = phase

    if (items.length === 0) {
      mountedProjectionRevision = revision
      return
    }

    const mapPoints = items.map((item, i) => ({
      item,
      x: coords[i][0],
      y: coords[i][1],
      z: coords[i][2],
      color: nodeFillForGraph(item.kind, item.subtype, customFills),
    }))

    mapHandle = createEmbeddingMap3d({
      container: rootEl,
      points: mapPoints,
      onSelectItem,
    })
    mapHandle.setSelectedId(selectedItemId ?? null)
    mapHandle.setVisibleSubtypes(visibleEntityTypes)
    mapHandle.setVisibleAuthorLayers(visibleAuthorLayers)

    const ro = new ResizeObserver(() => {
      mapHandle?.resize()
    })
    ro.observe(rootEl)
    queueMicrotask(() => mapHandle?.resize())

    mountedProjectionRevision = revision

    teardown = () => {
      ro.disconnect()
      mapHandle?.dispose()
      mapHandle = null
    }
  }

  function onLegendFiltersChanged() {
    queueMicrotask(() => mapHandle?.setVisibleSubtypes(visibleEntityTypes))
    onFiltersChanged?.()
  }

  onMount(() => {
    const unsub = subscribeEmbeddingProjection((next) => {
      phase = next
      if (next.kind === 'ready') {
        snapshotItems = next.items
        void mountMap()
      }
    })
    void ensureEmbeddingProjection()

    api = {
      setSelectedId(id) {
        queueMicrotask(() => mapHandle?.setSelectedId(id))
      },
      setVisibleSubtypes(types) {
        queueMicrotask(() => mapHandle?.setVisibleSubtypes(types))
      },
      setVisibleAuthorLayers(layers) {
        queueMicrotask(() => mapHandle?.setVisibleAuthorLayers(layers))
      },
      resize() {
        if (!visible) return
        queueMicrotask(() => mapHandle?.resize())
      },
      remount() {
        mountedProjectionRevision = null
        void mountMap()
      },
    }

    if (phase.kind === 'ready') {
      void mountMap()
    }

    return () => {
      unsub()
      disposeMap()
      mountedProjectionRevision = null
      api = null
    }
  })
</script>

<div class="relative flex h-full min-h-0 w-full flex-col">
  {#if phase.kind === 'loading' || phase.kind === 'idle'}
    <div class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
      <LoaderCircleIcon class="text-muted-foreground size-6 animate-spin" aria-hidden="true" />
      <p class="text-muted-foreground text-sm">{m.graph_embedding_fetching()}</p>
    </div>
  {:else if phase.kind === 'projecting'}
    <div class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
      <LoaderCircleIcon class="text-muted-foreground size-6 animate-spin" aria-hidden="true" />
      <div class="text-center">
        <p class="text-foreground text-sm font-medium">{m.graph_embedding_projecting()}</p>
        <p class="text-muted-foreground mt-1 text-xs">
          {m.graph_embedding_epoch({ current: phase.epoch, total: phase.totalEpochs })}
        </p>
        <div class="bg-muted mt-2 h-1.5 w-48 overflow-hidden rounded-full">
          <div
            class="bg-primary h-full rounded-full transition-all duration-150"
            style="width: {Math.round((phase.epoch / phase.totalEpochs) * 100)}%"
          ></div>
        </div>
      </div>
      <p class="text-muted-foreground/60 max-w-xs text-center text-[10px] leading-relaxed">
        {m.graph_embedding_umap_hint()}
      </p>
    </div>
  {:else if phase.kind === 'error'}
    <div class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 px-8">
      <p class="text-destructive text-center text-sm font-medium">{m.graph_embedding_failed()}</p>
      <p class="text-muted-foreground text-center text-xs">{phase.message}</p>
    </div>
  {:else if phase.kind === 'ready' && phase.items.length === 0}
    <div class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2">
      <p class="text-muted-foreground text-sm">{m.graph_embedding_empty()}</p>
      <p class="text-muted-foreground/70 text-xs">{m.graph_embedding_empty_hint()}</p>
    </div>
  {/if}

  <div
    bind:this={rootEl}
    class="text-foreground relative isolate z-0 h-full min-h-0 w-full overflow-hidden"
    role="img"
    aria-label={m.graph_embedding_aria()}
  ></div>

  {#if phase.kind === 'ready' && phase.items.length > 0}
    <div
      class="pointer-events-none absolute top-14 left-3 z-50 md:top-16"
      aria-label={m.graph_aria_entity_type_filter()}
    >
      <div class="pointer-events-auto w-[min(calc(100vw-1.5rem),11rem)]">
        <GraphEntityKindsLegend
          bind:visibleEntityTypes
          legendSections={graphLegendSections}
          graphStats={embeddingStats}
          panelId="embedding-map-legend-panel"
          onchange={onLegendFiltersChanged}
        />
      </div>
    </div>

    <p
      class="text-muted-foreground/50 pointer-events-none absolute top-8 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap text-[9px] md:top-12"
    >
      {m.graph_embedding_controls()}
    </p>
  {/if}
</div>

<style>
  :global(.embedding-map-label) {
    max-width: 11rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 1px 4px;
    border-radius: 2px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 10px;
    line-height: 1.2;
    color: var(--foreground);
    background: color-mix(in oklab, var(--background) 88%, transparent);
    border: 1px solid color-mix(in oklab, var(--border) 70%, transparent);
    opacity: 0.92;
    pointer-events: none;
    user-select: none;
  }

  :global(.embedding-map-label--selected) {
    font-weight: 600;
    opacity: 1;
    border-color: #fbbf24;
    box-shadow: 0 0 0 1px color-mix(in oklab, #fbbf24 35%, transparent);
  }
</style>
