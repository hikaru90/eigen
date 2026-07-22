<script lang="ts">
  import { onMount } from 'svelte'
  import type { GraphRearrangeResult } from '$lib/graph/graph-edit-api'
  import {
    graphRearrangeHadChanges,
    graphRearrangeSummaryLines,
  } from '$lib/graph/graph-rearrange-display'
  import {
    GRAPH_REARRANGE_PHASE_COPY,
    GRAPH_REARRANGE_PIPELINE,
    graphRearrangeProgressPercent,
    type GraphRearrangePhase,
    type GraphRearrangeTaskProgress,
  } from '$lib/graph/graph-rearrange-phases'
  import CheckIcon from '@lucide/svelte/icons/check'
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle'
  import X from '@lucide/svelte/icons/x'

  let {
    busy,
    complete,
    phaseEvents,
    activeTask,
    result,
    startedAt,
    onDismiss,
  }: {
    busy: boolean
    complete: boolean
    phaseEvents: GraphRearrangePhase[]
    activeTask: GraphRearrangeTaskProgress | null
    result: GraphRearrangeResult | null
    startedAt: number | null
    onDismiss: () => void
  } = $props()

  const summaryLines = $derived(result ? graphRearrangeSummaryLines(result) : [])
  const hadChanges = $derived(result ? graphRearrangeHadChanges(result) : false)
  const progress = $derived(graphRearrangeProgressPercent(phaseEvents, complete, activeTask))
  const activePhase = $derived(complete ? null : (phaseEvents.at(-1) ?? null))
  const donePhases = $derived(complete ? phaseEvents : phaseEvents.slice(0, -1))
  const activeStepIndex = $derived.by(() => {
    if (complete) return GRAPH_REARRANGE_PIPELINE.length - 1
    if (!activePhase) return -1
    return GRAPH_REARRANGE_PIPELINE.indexOf(activePhase)
  })

  let liveNowMs = $state(Date.now())
  onMount(() => {
    const id = setInterval(() => {
      liveNowMs = Date.now()
    }, 100)
    return () => clearInterval(id)
  })

  function formatDuration(ms: number): string {
    const roundedMs = Math.round(ms)
    if (roundedMs < 50) return ''
    if (roundedMs < 1000) return `${roundedMs}ms`
    const seconds = Math.round(roundedMs / 100) / 10
    return `${seconds.toFixed(1)}s`
  }

  const elapsed = $derived.by(() => {
    if (startedAt === null) return ''
    return formatDuration(liveNowMs - startedAt)
  })
</script>

<div class="rounded-lg bg-transparent p-3" role="status" aria-live="polite">
  <div class="mb-2 flex items-center justify-between text-xs text-muted-foreground">
    {#if complete}
      <span>Cleanup complete</span>
    {:else if activePhase}
      <span>Step {activeStepIndex + 1} of {GRAPH_REARRANGE_PIPELINE.length}</span>
    {:else}
      <span>Starting cleanup…</span>
    {/if}
    <span class="tabular-nums">{progress}%</span>
  </div>

  <div class="bg-muted mb-3 h-1.5 overflow-hidden rounded-full">
    <div
      class="bg-primary h-full transition-all duration-500 ease-out"
      style="width: {progress}%"
    ></div>
  </div>

  {#if busy}
    {#if donePhases.length > 0}
      <div class="mb-2 space-y-1">
        {#each donePhases as phase (phase)}
          <div class="flex min-w-0 items-start gap-2 text-xs">
            <CheckIcon class="mt-0.5 size-3 shrink-0 text-green-600" aria-hidden="true" />
            <span class="min-w-0 flex-1 font-medium text-green-700 dark:text-green-500">
              {GRAPH_REARRANGE_PHASE_COPY[phase].title}
            </span>
          </div>
        {/each}
      </div>
    {/if}

    <div class="flex items-start gap-3">
      <LoaderCircleIcon
        class="text-primary mt-0.5 size-4 shrink-0 animate-spin"
        aria-hidden="true"
      />
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 items-start justify-between gap-2">
          <p class="text-foreground text-sm font-medium">
            {activePhase
              ? GRAPH_REARRANGE_PHASE_COPY[activePhase].title
              : 'Rearranging and cleaning up graph'}
          </p>
          {#if elapsed}
            <span class="text-muted-foreground shrink-0 font-mono text-[11px] tabular-nums">
              {elapsed}
            </span>
          {/if}
        </div>
        <p class="text-muted-foreground mt-0.5 text-xs leading-relaxed">
          {#if activePhase === 'repair_relations' && activeTask && activeTask.total > 0}
            Processing thought {activeTask.processed} of {activeTask.total} with missing entity relations.
          {:else if activePhase}
            {GRAPH_REARRANGE_PHASE_COPY[activePhase].description}
          {:else}
            Preparing to prune weak edges, remove orphan nodes, and repair entity relations.
          {/if}
        </p>
      </div>
    </div>
  {:else if result}
    <div class="flex items-start gap-3">
      <CheckIcon class="mt-0.5 size-4 shrink-0 text-green-600" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 items-start justify-between gap-2">
          <p class="font-medium text-green-700 dark:text-green-500">Graph cleaned up</p>
          {#if elapsed}
            <span class="text-muted-foreground shrink-0 font-mono text-[11px] tabular-nums">
              {elapsed}
            </span>
          {/if}
        </div>
        {#if hadChanges}
          <ul class="text-muted-foreground mt-1.5 space-y-0.5 font-mono text-[11px]">
            {#each summaryLines as line (line.label)}
              <li class="flex min-w-0 items-baseline gap-x-1.5">
                <span class="text-foreground tabular-nums">{line.count}</span>
                <span>{line.label}</span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            No weak edges, orphan nodes, or missing relations needed cleanup.
          </p>
        {/if}
      </div>
      <button
        type="button"
        class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 shrink-0 rounded-md p-1 transition-colors focus-visible:ring-1 focus-visible:outline-none"
        aria-label="Dismiss cleanup summary"
        onclick={onDismiss}
      >
        <X class="size-3.5" strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  {/if}
</div>
