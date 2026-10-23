<script lang="ts">
  /**
   * /thought/[id] — a thought, up close (ei redesign, wave 3.1). The page keys the
   * sheet on the thought id, so opening an echo (same route, new id) rebuilds the
   * sheet: fresh state from the new load, the settle-in plays again, the echoes are
   * fetched for the new thought — no `$effect` syncing props into state.
   */
  import type { PageData } from './$types'
  import ThoughtSheet from './thought-sheet.svelte'

  let { data }: { data: PageData } = $props()
</script>

<svelte:head>
  <title>{data.thought.text.slice(0, 60)}</title>
</svelte:head>

{#key data.thought.id}
  <ThoughtSheet thought={data.thought} kinds={data.kinds} preferredTimezone={data.preferredTimezone} />
{/key}
