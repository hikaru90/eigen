<script lang="ts">
  import { m } from '$lib/paraglide/messages.js'
  import type { NowSegment } from './temporal-events-utils'
  import ArrowLeftRightIcon from '@lucide/svelte/icons/arrow-left-right'
  import type { Snippet } from 'svelte'

  type Props = {
    projectsMode: boolean
    nowSegment: NowSegment
    onToggleProjectsMode: () => void
    titleActions?: Snippet
    children?: Snippet
  }

  let { projectsMode, nowSegment, onToggleProjectsMode, titleActions, children }: Props = $props()

  const title = $derived(projectsMode ? m.graph_timeline_projects() : m.graph_timeline_tasks())

  const switchLabel = $derived(
    projectsMode ? m.graph_timeline_tasks() : m.graph_timeline_projects(),
  )
</script>

<header class="shrink-0 px-4 py-2">
  <div class="flex items-center justify-between gap-2">
    <div class="flex min-w-0 items-center gap-2">
      <h2 class="text-foreground shrink-0 text-[13px] leading-[1.2]">{title}</h2>
      <button
        type="button"
        class="text-foreground inline-flex shrink-0 items-center gap-1 rounded-full bg-white/80 py-1 pl-2 pr-3 text-[13px] leading-[1.2] ring-1 ring-white transition-colors hover:bg-white/90 dark:bg-white/10 dark:ring-white/20 dark:hover:bg-white/15"
        onclick={onToggleProjectsMode}
      >
        <ArrowLeftRightIcon class="size-2.5 shrink-0 opacity-90" aria-hidden="true" />
        {switchLabel}
      </button>
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
