<script lang="ts">
  import AuthorLayerIcon from '$lib/components/author-layer-icon.svelte'
  import { authorChipClassFor } from '$lib/memory/author-layer-chrome'
  import { m } from '$lib/paraglide/messages.js'

  let {
    author = 'user',
    authorLabel,
    size = 'default',
  }: {
    author?: 'user' | 'agent'
    authorLabel?: string | null
    size?: 'default' | 'sm'
  } = $props()

  const isAgent = $derived(author === 'agent')
  const title = $derived(
    isAgent
      ? authorLabel
        ? `Captured by agent · ${authorLabel}`
        : 'Captured by an agent'
      : m.graph_timeline_projects_filter_human(),
  )
  const label = $derived(
    isAgent ? authorLabel?.trim() || 'Agent' : m.graph_timeline_projects_filter_human(),
  )
  const chipClass = $derived(authorChipClassFor(isAgent ? 'agent' : 'user', size))
</script>

<span class={chipClass} {title}>
  <AuthorLayerIcon kind={isAgent ? 'agent' : 'user'} />
  <span class="truncate">{label}</span>
</span>
