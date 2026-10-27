<script lang="ts">
  import CornerDownLeft from '@lucide/svelte/icons/corner-down-left'
  import X from '@lucide/svelte/icons/x'
  import { voiceFailureMessage } from '$lib/capture/voice-failure-message'
  import {
    formatVoiceTimer,
    VOICE_MESSAGE_MAX_MS,
    type VoiceMessageView,
  } from '$lib/capture/voice-message'
  import MeshSpinner from '$lib/components/brand/mesh-spinner.svelte'
  import { m } from '$lib/paraglide/messages.js'

  /**
   * The voice-message bar: what the writer's field becomes while a voice message exists.
   * Recording: discard, a live scrolling waveform, the timer against the 5-minute cap, send.
   * Transcribing: the frozen waveform behind a working mesh and "Transcribing…" — nothing to
   * press. Failed: the plain error with Retry (when the clip is still in memory) and Discard.
   * Presentational only: the session (`$lib/capture/voice-message`) owns every decision.
   */
  type Props = {
    view: VoiceMessageView
    onsend: () => void
    ondiscard: () => void
    onretry: () => void
  }

  let { view, onsend, ondiscard, onretry }: Props = $props()

  const failure = $derived(view.phase === 'failed' ? view.failure : null)

  /** A quiet bar is still a visible line: levels map onto 12–100% of the bar's height. */
  function barScale(level: number): string {
    return (0.12 + 0.88 * Math.min(1, Math.max(0, level))).toFixed(3)
  }

  /** The control a keyboard user lands on when the bar (or its error) replaces the field. */
  function focusOnMount(node: HTMLElement, enabled = true) {
    if (enabled) node.focus({ preventScroll: true })
  }

  const roundButton =
    'grid place-items-center shrink-0 size-9 p-0 border-0 rounded-full cursor-pointer [transition:opacity_0.3s_var(--ease),transform_0.4s_var(--ease),color_0.3s_var(--ease)] hover:enabled:-translate-y-px'
</script>

{#snippet waveform(dim: boolean)}
  <!-- display only: one bar per mic reading, the newest on the right; the oldest scroll out on the left -->
  <div
    class={[
      'flex flex-1 min-w-0 h-7 items-center justify-end gap-[2px] overflow-hidden transition-opacity duration-[400ms] ease-settle',
      dim && 'opacity-40',
    ]}
    data-testid="voice-waveform"
    aria-hidden="true"
  >
    {#each view.levels as level, i (i)}
      <span
        class="block w-[2px] h-full shrink-0 rounded-full bg-ink origin-center [transform:scaleY(var(--lvl))] transition-transform duration-75 ease-out motion-reduce:transition-none"
        style:--lvl={barScale(level)}
      ></span>
    {/each}
  </div>
{/snippet}

{#snippet timer()}
  <span
    class="shrink-0 font-mesh text-[15px] tabular-nums text-ink"
    role="timer"
    aria-label={m.voice_timer()}
    data-testid="voice-timer"
    >{formatVoiceTimer(view.elapsedMs)} <span class="text-ink-3">/ {formatVoiceTimer(VOICE_MESSAGE_MAX_MS)}</span></span
  >
{/snippet}

<div
  class="flex flex-1 min-w-0 items-center gap-3 -ml-3 animate-[fade_0.3s_var(--ease)_both] motion-reduce:[animation-duration:0.01ms]"
  role="group"
  aria-label={m.voice_message_label()}
  data-testid="voice-bar"
>
  {#if view.phase === 'recording'}
    <button
      type="button"
      class="{roundButton} bg-transparent text-ink-3 pointer-fine:hover:text-ink"
      aria-label={m.voice_discard()}
      title={m.voice_discard()}
      data-testid="voice-discard"
      onclick={ondiscard}
    >
      <X size={18} strokeWidth={1.75} aria-hidden="true" />
    </button>
    {@render waveform(false)}
    <span
      class="shrink-0 size-1.5 rounded-full bg-clay animate-[breathe_1.6s_ease-in-out_infinite] motion-reduce:animate-none"
      aria-hidden="true"
    ></span>
    {@render timer()}
    <button
      type="button"
      use:focusOnMount
      class="{roundButton} bg-ink text-paper"
      aria-label={m.voice_send()}
      title={m.voice_send()}
      data-testid="voice-send"
      onclick={onsend}
    >
      <CornerDownLeft size={16} strokeWidth={1.75} aria-hidden="true" />
    </button>
  {:else if view.phase === 'transcribing'}
    <div
      class="flex items-center gap-2.5 pl-3 shrink-0 text-[15px] text-ink-2"
      role="status"
      aria-live="polite"
      data-testid="voice-status"
    >
      <MeshSpinner size={20} working />
      <span>{m.voice_transcribing()}</span>
    </div>
    {@render waveform(true)}
    {@render timer()}
  {:else if failure}
    <p
      class="m-0 flex-1 min-w-0 pl-3 font-mesh text-[15px] leading-5 text-clay"
      role="alert"
      data-testid="voice-error"
    >
      {voiceFailureMessage(failure)}
    </p>
    {#if failure.retryable}
      <button
        type="button"
        use:focusOnMount
        class="shrink-0 h-9 px-3.5 border-0 rounded-full bg-ink text-paper text-sm cursor-pointer [transition:transform_0.4s_var(--ease)] pointer-fine:hover:-translate-y-px"
        data-testid="voice-retry"
        onclick={onretry}
      >
        {m.voice_retry()}
      </button>
    {/if}
    <button
      type="button"
      use:focusOnMount={!failure.retryable}
      class="{roundButton} bg-transparent text-ink-3 pointer-fine:hover:text-ink"
      aria-label={failure.retryable ? m.voice_discard() : m.voice_dismiss()}
      title={failure.retryable ? m.voice_discard() : m.voice_dismiss()}
      data-testid="voice-discard"
      onclick={ondiscard}
    >
      <X size={18} strokeWidth={1.75} aria-hidden="true" />
    </button>
  {/if}
</div>
