<script lang="ts">
  import type { PageData } from './$types'
  import ThreadDetail from '../thread-detail.svelte'

  /** A thread, up close — a real route, so back/forward and the Mesh layout's blur swap carry it. */
  let { data }: { data: PageData } = $props()
</script>

<ThreadDetail
  title={data.title}
  entityId={data.entityId}
  standing={data.standing}
  questions={data.questions}
  thoughts={data.thoughts}
  preferredTimezone={data.preferredTimezone}
  kinds={data.kinds}
/>
