<script lang="ts">
  import { onMount } from 'svelte'
  import MemorySurfaceNav from '$lib/components/memory-surface-nav.svelte'
  import {
    disposeEmbeddingProjection,
    ensureEmbeddingProjection,
  } from '$lib/graph/embedding-map-projection'

  let { children } = $props()

  onMount(() => {
    void ensureEmbeddingProjection()
    return () => {
      // Leaving the Memory hub: hard-stop any in-flight UMAP worker so it
      // doesn't keep grinding on the background after navigation.
      disposeEmbeddingProjection()
    }
  })
</script>

{@render children()}
<MemorySurfaceNav />
