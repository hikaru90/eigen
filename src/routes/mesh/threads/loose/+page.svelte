<script lang="ts">
  import type { PageData } from './$types'
  import { m } from '$lib/paraglide/messages.js'
  import ThreadDetail from '../thread-detail.svelte'

  /** Loose ends: thoughts not on a thread yet — still part of the mesh, never nagged about. */
  let { data }: { data: PageData } = $props()
</script>

<ThreadDetail
  title={m.threads_loose_ends()}
  entityId={null}
  standing={null}
  questions={[]}
  thoughts={data.thoughts}
  preferredTimezone={data.preferredTimezone}
  kinds={data.kinds}
/>
