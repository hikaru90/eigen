<script lang="ts">
  import type { CaptureIngestPhase } from '$lib/capture/ingest-phases'
  import type { ProgressEvent } from '$lib/capture/consume-capture-ndjson'
  import CaptureStepRing from '$lib/components/capture-step-ring.svelte'
  import {
    captureQueueStatusLine,
    captureQueueStatusText,
    totalPipelineSteps,
  } from '$lib/capture/capture-progress'

  interface Props {
    processing: boolean
    pendingCount: number
    events: ProgressEvent[]
    pipeline: Array<CaptureIngestPhase | CaptureIngestPhase[]>
    offline?: boolean
  }

  let { processing, pendingCount, events, pipeline, offline = false }: Props = $props()

  const total = $derived(totalPipelineSteps(pipeline))
  const activeEvent = $derived(events.at(-1) ?? null)
  const statusLine = $derived(
    captureQueueStatusLine({ processing, pendingCount, activeEvent, pipeline }),
  )
  const statusText = $derived(captureQueueStatusText(statusLine))

  const completedSteps = $derived.by(() => {
    if (statusLine.kind === 'step') return statusLine.stepIndex
    if (statusLine.kind === 'starting') return 0
    return 0
  })

  const ringActive = $derived(processing && statusLine.kind !== 'queued')
</script>

<div
  class="flex flex-row items-center gap-3 min-w-0"
  role="status"
  aria-live="polite"
  aria-atomic="true"
>
  <CaptureStepRing {total} completed={completedSteps} active={ringActive} />
  <div class="min-w-0 flex-1">
    <p class="text-sm font-medium text-foreground truncate leading-snug">{statusText}</p>
    {#if offline && (processing || pendingCount > 0)}
      <p class="text-xs text-muted-foreground truncate leading-snug mt-0.5">
        Offline — will resume when connected
      </p>
    {:else if processing && pendingCount > 0}
      <p class="text-xs text-muted-foreground truncate leading-snug mt-0.5">
        {pendingCount} more in queue
      </p>
    {:else if !processing && pendingCount > 1}
      <p class="text-xs text-muted-foreground truncate leading-snug mt-0.5">
        Processing in background
      </p>
    {/if}
  </div>
</div>
