<script lang="ts">
  import CheckIcon from '@lucide/svelte/icons/check'
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle'
  import { onMount } from 'svelte'
  import type { ProgressEvent } from '$lib/capture/consume-capture-ndjson'
  import type { CaptureIngestPhase } from '$lib/capture/ingest-phases'
  import { CAPTURE_INGEST_PHASE_COPY } from '$lib/capture/ingest-phases'

  type TimestampedEvent = {
    event: ProgressEvent
    arrivedAt: number
  }

  type Props = {
    /** All progress events received so far, in arrival order, with timestamps. */
    events: TimestampedEvent[]
    /** The canonical pipeline shape: sequential phases or parallel groups. */
    pipeline: Array<CaptureIngestPhase | CaptureIngestPhase[]>
    /** Timestamp when the overall capture started. */
    startMs: number
    /** When set, freezes elapsed timers (e.g. scroll-driven marketing demo). */
    nowOverrideMs?: number
    /** When true, every step is shown as completed — no active spinner. */
    allComplete?: boolean
  }

  let { events, pipeline, startMs, nowOverrideMs, allComplete = false }: Props = $props()

  // Last event is "active"; everything before it is "completed".
  const activeItem = $derived(allComplete ? null : (events.at(-1) ?? null))
  const doneItems = $derived(allComplete ? events : events.slice(0, -1))
  const totalSteps = $derived(pipeline.length)

  // Which pipeline slot does the active event belong to?
  const activeStepIndex = $derived.by(() => {
    if (!activeItem) return -1
    const ev = activeItem.event
    for (let i = 0; i < pipeline.length; i++) {
      const slot = pipeline[i]
      if (ev.parallel) {
        if (Array.isArray(slot) && ev.phases.some((p) => slot.includes(p))) return i
      } else {
        if (!Array.isArray(slot) && slot === ev.phase) return i
        if (Array.isArray(slot) && slot.includes(ev.phase)) return i
      }
    }
    return -1
  })

  const progress = $derived(
    allComplete ? 100 : activeStepIndex >= 0 ? ((activeStepIndex + 1) / totalSteps) * 100 : 0,
  )

  const nextSlot = $derived(
    activeStepIndex >= 0 && activeStepIndex < pipeline.length - 1
      ? pipeline[activeStepIndex + 1]
      : null,
  )

  function eventLabel(ev: ProgressEvent): string {
    if (ev.parallel) return ev.phases.map((p) => CAPTURE_INGEST_PHASE_COPY[p].title).join(' · ')
    return CAPTURE_INGEST_PHASE_COPY[ev.phase].title
  }

  function slotLabel(slot: CaptureIngestPhase | CaptureIngestPhase[]): string {
    if (Array.isArray(slot)) return slot.map((p) => CAPTURE_INGEST_PHASE_COPY[p].title).join(' · ')
    return CAPTURE_INGEST_PHASE_COPY[slot].title
  }

  function formatDuration(ms: number): string {
    const roundedMs = Math.round(ms)
    if (roundedMs < 50) return ''
    if (roundedMs < 1000) return `${roundedMs}ms`
    const seconds = Math.round(roundedMs / 100) / 10
    return `${seconds.toFixed(1)}s`
  }

  function durationLabel(item: TimestampedEvent, index: number): string {
    const next = events[index + 1]
    const endMs = next?.arrivedAt ?? (allComplete ? nowMs : item.arrivedAt)
    return formatDuration(endMs - item.arrivedAt)
  }

  // Live elapsed ticker while mounted (cheap); frozen when nowOverrideMs is set.
  let liveNowMs = $state(Date.now())
  onMount(() => {
    if (nowOverrideMs !== undefined) return
    const id = setInterval(() => {
      liveNowMs = Date.now()
    }, 100)
    return () => clearInterval(id)
  })
  const nowMs = $derived(nowOverrideMs ?? liveNowMs)
  const totalElapsed = $derived.by(() => {
    if (!startMs && startMs !== 0) return ''
    return formatDuration(nowMs - startMs)
  })
  // Per-step elapsed — how long the active step has been running.
  const stepElapsed = $derived.by(() => {
    if (!activeItem) return ''
    return formatDuration(nowMs - activeItem.arrivedAt)
  })
</script>

<div class="min-w-0 space-y-3" role="status" aria-live="polite">
  <!-- Header: step counter + running clock -->
  <div class="flex items-center justify-between text-xs text-muted-foreground">
    {#if allComplete}
      <span>All {totalSteps} steps complete</span>
      <span class="tabular-nums">{totalElapsed}</span>
    {:else if activeItem}
      <span>Step {activeStepIndex + 1} of {totalSteps}</span>
      <span class="tabular-nums">{totalElapsed}</span>
    {:else}
      <span>Starting…</span>
      <span></span>
    {/if}
  </div>

  <!-- Progress bar -->
  <div class="h-1.5 bg-muted rounded-full overflow-hidden">
    <div
      class="h-full bg-primary transition-all duration-500 ease-out"
      style="width: {progress}%"
    ></div>
  </div>

  <!-- Completed steps -->
  {#if doneItems.length > 0}
    <div class="space-y-1">
      {#each doneItems as item, i (i)}
        {@const dur = durationLabel(item, i)}
        <div class="flex min-w-0 items-start gap-2 text-xs">
          <CheckIcon class="mt-0.5 size-3 shrink-0 text-green-600" aria-hidden="true" />
          <span
            class="min-w-0 flex-1 wrap-break-word font-medium text-green-700 dark:text-green-500"
          >
            {eventLabel(item.event)}
          </span>
          {#if dur}
            <span class="text-muted-foreground/50 tabular-nums shrink-0">{dur}</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  <!-- Active step -->
  {#if allComplete}
    <div
      class="flex items-center gap-2 rounded-lg border border-green-600/20 bg-green-600/5 p-3 text-sm"
    >
      <CheckIcon class="size-4 shrink-0 text-green-600" aria-hidden="true" />
      <p class="font-medium text-green-700 dark:text-green-500">Capture complete</p>
    </div>
  {:else if activeItem}
    <div class="flex items-start gap-3 p-3 bg-primary/5 rounded-lg border border-primary/20">
      <LoaderCircleIcon
        class="size-4 animate-spin text-primary shrink-0 mt-0.5"
        aria-hidden="true"
      />
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 items-start justify-between gap-2">
          <p class="min-w-0 flex-1 wrap-break-word text-sm font-medium text-foreground">
            {eventLabel(activeItem.event)}
          </p>
          <span class="text-xs tabular-nums text-muted-foreground shrink-0">{stepElapsed}</span>
        </div>
        {#if !activeItem.event.parallel}
          <p class="text-muted-foreground text-xs mt-0.5 leading-relaxed">
            {CAPTURE_INGEST_PHASE_COPY[activeItem.event.phase].description}
          </p>
        {:else}
          <p class="text-muted-foreground text-xs mt-0.5">Running in parallel</p>
        {/if}
      </div>
    </div>
  {:else}
    <!-- Before first event arrives -->
    <div class="flex items-center gap-3 p-3">
      <LoaderCircleIcon class="size-4 animate-spin text-primary shrink-0" aria-hidden="true" />
      <p class="text-sm font-medium text-foreground">Starting capture…</p>
    </div>
  {/if}

  <!-- Up next -->
  {#if nextSlot}
    <p class="text-xs text-muted-foreground/50 pl-1">Up next: {slotLabel(nextSlot)}</p>
  {/if}
</div>
