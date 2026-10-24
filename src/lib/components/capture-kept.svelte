<script lang="ts">
  import type { KeptStage } from '$lib/capture/kept-progress'
  import MeshSpinner from '$lib/components/brand/mesh-spinner.svelte'
  import { m } from '$lib/paraglide/messages.js'

  /**
   * After Capture, in the heading's place: how the thought was kept (its type and
   * thread — the reading the user accepted), then the background pass as three steps
   * (saved → indexing → linked) with the mesh spinner while it works. The kept words
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

  const steps = $derived([m.capture_kept_step_saved(), m.capture_kept_step_indexing(), m.capture_kept_step_linked()])
  const reached = $derived(stage === 'saving' ? 1 : stage === 'linked' ? 3 : 2)
  const working = $derived(stage === 'saving' || stage === 'indexing')
</script>

<div data-testid="capture-kept" class="animate-[fade_0.5s_var(--ease)_both]">
  <p class="m-0 font-you text-[clamp(32px,4.4vw,46px)] leading-[1.16] tracking-[-0.014em] text-ink-3 max-[640px]:text-[29px]">
    {m.capture_kept_as()} <span class="text-ink">{typeLabel}</span>
    <br />
    <span class="text-ink">{threadLabel}</span>
  </p>

  <div class="mt-6 flex items-center gap-2.5 font-mesh text-sm text-ink-3 [&_.spinner]:size-4 [&_.spinner]:shrink-0">
    <MeshSpinner size={16} {working} />
    {#if stage === 'failed'}
      <span class="text-clay" role="alert">{m.capture_kept_failed({ reason: failureReason ?? '—' })}</span>
    {:else if stage === 'linked'}
      <span>{m.capture_kept_linked({ entities: entityCount, thoughts: linkedCount })}</span>
    {:else if slow}
      <span>{m.capture_kept_slow()}</span>
    {:else}
      <span>{steps[reached - 1]}</span>
    {/if}
  </div>

  <div
    class="mt-3 grid max-w-[320px] grid-cols-3 gap-1.5"
    role="progressbar"
    aria-label={m.capture_kept_progress_label()}
    aria-valuemin={1}
    aria-valuemax={3}
    aria-valuenow={reached}
    aria-valuetext={steps[reached - 1]}
    data-testid="capture-kept-progress"
  >
    {#each steps as step, i (step)}
      <span
        class={[
          'h-[3px] rounded-full transition-colors duration-500 ease-settle',
          stage === 'failed' && i === 1 ? 'bg-clay' : i < reached ? 'bg-ink-2' : 'bg-ink-4',
          working && i === reached - 1 && 'animate-[breathe_2.2s_var(--ease-io)_infinite] motion-reduce:[animation:none]',
        ]}
      ></span>
    {/each}
  </div>
</div>
