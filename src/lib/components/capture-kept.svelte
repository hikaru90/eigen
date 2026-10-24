<script lang="ts">
  import { onMount } from 'svelte'
  import type { KeptStage } from '$lib/capture/kept-progress'
  import MeshSpinner from '$lib/components/brand/mesh-spinner.svelte'
  import { m } from '$lib/paraglide/messages.js'

  /**
   * After Capture: the capture's process, as a status strip that stays up — how the
   * thought was kept (its type and thread — the reading the user accepted), then one
   * line for the background pass with the mesh spinner: while it indexes the line
   * cycles through what the pass actually does (entities, meaning, links, timeline),
   * then it says what got linked. It survives the next reading and the next words (board b4c5457a:
   * the old heading slot let one keystroke hide the whole process). The kept words
   * are never shown again (editing lives in Mesh).
   */
  let {
    typeLabel,
    threadLabel,
    stage,
    entityCount,
    linkedCount,
    slow,
    failureReason,
  }: {
    typeLabel: string
    threadLabel: string
    stage: KeptStage
    entityCount: number
    linkedCount: number
    /** Indexing outlasted the polling window: it carries on in the background. */
    slow: boolean
    /** The server's reason when the background pass failed (after its retries). */
    failureReason: string | null
  } = $props()

  const working = $derived(stage === 'saving' || stage === 'indexing')
  /** What the background pass does, in order; the line steps through them while indexing. */
  const explain = [
    m.capture_kept_working_1,
    m.capture_kept_working_2,
    m.capture_kept_working_3,
    m.capture_kept_working_4,
  ]
  let tick = $state(0)
  const workingLine = $derived(explain[tick % explain.length]())

  onMount(() => {
    const timer = setInterval(() => {
      tick += 1
    }, 2600)
    return () => clearInterval(timer)
  })
</script>

<div data-testid="capture-kept" role="status" class="animate-[fade_0.5s_var(--ease)_both]">
  <p class="m-0 font-mesh text-sm text-ink-3">
    {m.capture_kept_as()} <span class="font-you text-base tracking-[-0.01em] text-ink">{typeLabel}</span>
    <span aria-hidden="true"> · </span>
    <span class="font-you text-base tracking-[-0.01em] text-ink">{threadLabel}</span>
  </p>

  <div
    class="mt-2 flex items-center gap-2.5 font-mesh text-sm text-ink-3 [&_.spinner]:size-4 [&_.spinner]:shrink-0"
    data-testid="capture-kept-progress"
    data-stage={stage}
  >
    <MeshSpinner size={16} {working} />
    {#if stage === 'failed'}
      <span class="text-clay" role="alert">{m.capture_kept_failed({ reason: failureReason ?? '—' })}</span>
    {:else if stage === 'linked'}
      <span>{m.capture_kept_linked({ entities: entityCount, thoughts: linkedCount })}</span>
    {:else if slow}
      <span>{m.capture_kept_slow()}</span>
    {:else if stage === 'saving'}
      <span>{m.capture_kept_saving()}</span>
    {:else}
      {#key workingLine}
        <span class="animate-[fade_0.5s_var(--ease)_both] motion-reduce:[animation:none]">{workingLine}</span>
      {/key}
    {/if}
  </div>
</div>
