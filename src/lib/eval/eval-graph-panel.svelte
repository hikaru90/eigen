<script lang="ts">
  import { onMount } from 'svelte'
  import ForceGraph from '$lib/components/graph/force-graph.svelte'
  import type { EvalGraphSnapshotView } from './display'

  let {
    snapshot,
  }: {
    snapshot: EvalGraphSnapshotView
  } = $props()

  let hostEl: HTMLDivElement | undefined
  let ready = $state(false)

  onMount(() => {
    if (!hostEl) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) ready = true
      },
      { rootMargin: '64px' },
    )
    io.observe(hostEl)
    return () => io.disconnect()
  })
</script>

<div bind:this={hostEl} class="bg-muted/20 flex h-80 flex-col rounded-md border">
  {#if ready}
    <div class="flex min-h-0 flex-1 flex-col">
      <ForceGraph
        nodes={snapshot.nodes}
        edges={snapshot.edges}
        height="100%"
        statusSuffix={snapshot.capturedAt
          ? `snapshot ${new Date(snapshot.capturedAt).toLocaleTimeString()}`
          : ''}
      />
    </div>
  {:else}
    <p class="text-muted-foreground flex flex-1 items-center justify-center p-4 text-xs">
      Loading graph…
    </p>
  {/if}
</div>
