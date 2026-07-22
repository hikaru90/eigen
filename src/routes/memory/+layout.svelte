<script lang="ts">
  import { onMount } from 'svelte'
  import MemorySurfaceNav from '$lib/components/memory-surface-nav.svelte'
  import { ensureEmbeddingProjection } from '$lib/graph/embedding-map-projection'

  let { children } = $props()

  onMount(() => {
    void ensureEmbeddingProjection()
  })
</script>

{@render children()}
<MemorySurfaceNav />
