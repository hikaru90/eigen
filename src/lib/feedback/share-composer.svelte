<script lang="ts">
  import type { BoardArea, BoardCheckResult, BoardKind } from './board-types'
  import { appendVoiceTranscript } from '$lib/capture/transcribe-audio'
  import MeshSpinner from '$lib/components/brand/mesh-spinner.svelte'
  import GlassWriter from '$lib/components/writer/glass-writer.svelte'
  import { m } from '$lib/paraglide/messages.js'
  import { betterCopy } from './better-copy'
  import { areaPhrase, kindPhrase, statusLabel } from './labels'
  import { canShare } from './share-composer'

  /**
   * The share bar (ei app.js:1716-1810 `makeComposer`): the shared GlassWriter docked at
   * the bottom; the judge's reading and the chorus card sit in the quiet row above it.
   * Share runs the board's LLM judge first (`oncheck`, MB-9): it reads kind and area
   * and may name the same request already on the board. Then the chorus card offers
   * "Vote for it instead" or "Mine's different"; with no duplicate the idea is
   * created straight away with the judged reading (`oncreate`). The author corrects
   * kind/area on their own row afterwards (D5).
   */
  type Props = {
    maxLength: number
    busy?: boolean
    /** The judge. Resolves null when it failed (the page shows why). */
    oncheck: (text: string) => Promise<BoardCheckResult | null>
    /** Create the idea. Resolves true when it landed (composer resets itself). */
    oncreate: (draft: { title: string; kind: BoardKind; area: BoardArea }) => Promise<boolean>
    /** "Vote for it instead": the duplicate's id (after the composer reset). */
    onvoteinstead: (id: string) => void
  }

  let { maxLength, busy = false, oncheck, oncreate, onvoteinstead }: Props = $props()

  let text = $state('')
  /** The judge's answer for exactly this draft. */
  let checked = $state<{ title: string; result: BoardCheckResult } | null>(null)
  let working = $state(false)
  let writer = $state<GlassWriter | null>(null)
  /** The draft when dictation started; transcripts append to it, like Capture. */
  let voiceBaseText = ''

  const shareable = $derived(canShare(text, maxLength) && !busy && !working)
  const current = $derived(checked && checked.title === text.trim() ? checked.result : null)
  const duplicate = $derived(current?.duplicateOf ?? null)
  const showChorus = $derived(!!duplicate)

  function reset(): void {
    text = ''
    checked = null
  }

  async function create(result: BoardCheckResult, title: string): Promise<void> {
    working = true
    try {
      const landed = await oncreate({ title, kind: result.kind, area: result.area })
      if (landed) reset()
    } finally {
      working = false
    }
  }

  /** "Mine's different": share it anyway, with the judge's reading. */
  function shareAnyway(): void {
    if (!current) return
    void create(current, text.trim())
  }

  /** "Vote for it instead": clear the draft, then let the page lend the vote and reveal the row. */
  function joinChorus(): void {
    const id = duplicate?.id
    if (!id) return
    reset()
    onvoteinstead(id)
  }

  /** Let the composer hear keys typed anywhere on the page (ei app.js:1853). */
  export function focus(): void {
    writer?.focus()
  }

  async function submit(): Promise<void> {
    if (!shareable) return
    const title = text.trim()
    working = true
    let result: BoardCheckResult | null
    try {
      result = await oncheck(title)
    } finally {
      working = false
    }
    if (!result || text.trim() !== title) return
    checked = { title, result }
    if (!result.duplicateOf) await create(result, title)
  }
</script>

<GlassWriter
  bind:this={writer}
  bind:value={text}
  placeholder={m.better_composer_placeholder()}
  submitLabel={m.better_share()}
  maxLength={maxLength}
  submitDisabled={!shareable}
  busy={busy || working}
  spellcheck={false}
  onsubmit={() => void submit()}
  onvoicestart={() => {
    voiceBaseText = text
  }}
  ontranscript={(transcript) => {
    text = appendVoiceTranscript(voiceBaseText, transcript)
  }}
  onpartialtranscript={(transcript) => {
    text = appendVoiceTranscript(voiceBaseText, transcript)
  }}
>
  {#snippet above()}
    <!-- duplicate chorus: votes pile up behind one request instead of scattering -->
    <div
      class={["grid grid-rows-[0fr] opacity-0 [transition:grid-template-rows_0.6s_var(--ease),opacity_0.5s_var(--ease),margin_0.6s_var(--ease)]", showChorus && 'grid-rows-[1fr] opacity-100 mb-3']}
      aria-hidden={!showChorus}
    >
      <div class="overflow-hidden">
        {#if duplicate}
          <div class="p-3.5 px-4 rounded-[14px] bg-paper-2">
            <div class="flex items-center gap-2 text-sm text-ink-3 before:content-[''] before:size-[5px] before:rounded-full before:bg-signal">{betterCopy.similarHeading}</div>
            <div class="mt-1.5 font-you text-[18px] leading-[1.25] text-ink">{duplicate.title}</div>
            <div class="mt-[3px] text-sm text-ink-3">
              {duplicate.score}
              {betterCopy.votes}
              ·
              {statusLabel(duplicate.status)}
            </div>
            <div class="flex items-center gap-4 mt-3">
              <button
                class="border-0 whitespace-nowrap h-[30px] px-3.5 rounded-full bg-ink text-paper text-sm cursor-pointer transition-transform duration-[400ms] ease-settle pointer-fine:hover:-translate-y-px"
                type="button"
                onclick={joinChorus}
              >
                {duplicate.myVote === 1 || duplicate.own ? betterCopy.alreadyVoted : betterCopy.voteInstead}
              </button>
              <button
                class="p-0 border-0 bg-transparent [font:inherit] text-sm text-ink-2 transition-colors duration-300 ease-settle cursor-pointer pointer-fine:hover:text-ink"
                type="button"
                disabled={working || busy}
                onclick={shareAnyway}
              >
                {betterCopy.minesDifferent}
              </button>
            </div>
          </div>
        {/if}
      </div>
    </div>

    <!-- the reading: the judge at work, then what it read ("Sounds like a bug in Capture") -->
    <div
      class={["flex items-center gap-2 h-0 overflow-hidden text-sm text-ink-3 opacity-0 [transition:height_0.5s_var(--ease),margin_0.5s_var(--ease),opacity_0.5s_var(--ease)] [&_.spinner]:shrink-0 [&_.spinner]:size-5", (working || current) && 'h-[22px] mb-2 opacity-100']}
      aria-live="polite"
    >
      <MeshSpinner size={20} working={working} />
      <span class="animate-[fade_0.5s_var(--ease)_both] motion-reduce:[animation-duration:0.01ms]">
        {#if working && !current}
          {betterCopy.checking}
        {:else if current}
          {m.capture_reading_sounds_like()}
          <span class="text-ink">{kindPhrase(current.kind)}</span>
          {betterCopy.readingIn}
          <span class="text-ink">{areaPhrase(current.area)}</span>
        {/if}
      </span>
    </div>
  {/snippet}
</GlassWriter>
