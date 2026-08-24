<script lang="ts">
  import type { Snippet } from 'svelte'
  import { m } from '$lib/paraglide/messages.js'

  type Props = {
    mode: 'tasks' | 'projects'
    titleActions?: Snippet
    children?: Snippet
  }

  let { mode, titleActions, children }: Props = $props()

  const title = $derived(mode === 'projects' ? m.graph_timeline_projects() : m.graph_timeline_tasks())
</script>

<header class="shrink-0 px-4 py-2">
  <div class="flex items-center justify-between gap-2">
    <div class="flex min-w-0 items-center gap-2">
      <h2 class="text-foreground shrink-0 text-[13px] leading-[1.2]">{title}</h2>
    </div>
    <div class="flex shrink-0 items-center gap-1">
      {#if titleActions}
        {@render titleActions()}
      {/if}
    </div>
  </div>

  {#if children}
    <div class="mt-3 w-full pt-2">{@render children()}</div>
  {/if}
</header>
