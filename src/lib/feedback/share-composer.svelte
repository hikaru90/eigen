<script lang="ts">
  import type { BoardArea, BoardIdea, BoardKind } from './board-types'
  import MeshSpinner from '$lib/components/brand/mesh-spinner.svelte'
  import { m } from '$lib/paraglide/messages.js'
  import { betterCopy } from './better-copy'
  import { areaPhrase, kindPhrase, statusLabel } from './labels'
  import {
    DEFAULT_READING,
    canShare,
    findExactDuplicate,
    nextArea,
    nextKind,
    type ReadingChoice,
  } from './share-composer'

  /**
   * The share bar (ei app.js:1716-1810 `makeComposer`, styles.css .circle-bar):
   * the one writer, docked at the bottom — an unboxed field in your voice, the ink
   * pill ("Share ↵") beside it, the reading line above, and the duplicate chorus
   * card above that. The page fades out behind it (the root layout's
   * `view-feedback` mask handles that).
   *
   * HONEST THIS PASS: the reading line is a *manual chooser*, not the mesh's
   * reading — both underlined words cycle on tap and nothing is inferred from the
   * typed words (no string heuristics; the LLM reading arrives with the board
   * backend). The chorus card fires only on an exact duplicate title, which is
   * dedup, not a similarity judgement.
   */
  type Props = {
    /** The board rows, for the exact-duplicate chorus check. */
    ideas: readonly BoardIdea[]
    maxLength: number
    busy?: boolean
    /** Share the draft. Resolves true when it landed (composer resets itself). */
    onshare: (draft: {
      text: string
      kind: BoardKind
      area: BoardArea
    }) => Promise<boolean> | boolean
    /** "Vote for it instead": the chorus card's row id (after the composer reset). */
    onvoteinstead: (id: string) => void
  }

  let { ideas, maxLength, busy = false, onshare, onvoteinstead }: Props = $props()

  let text = $state('')
  let reading = $state<Readonly<ReadingChoice>>(DEFAULT_READING)
  let dismissedId = $state<string | null>(null)
  let inputEl = $state<HTMLTextAreaElement | null>(null)

  const hasText = $derived(text.trim().length > 0)
  const shareable = $derived(canShare(text, maxLength) && !busy)
  const duplicate = $derived(hasText ? findExactDuplicate(ideas, text) : null)
  const showChorus = $derived(!!duplicate && duplicate.id !== dismissedId)

  function reset(): void {
    text = ''
    reading = DEFAULT_READING
    dismissedId = null
  }
  function cycleArea(): void {
    reading = { ...reading, area: nextArea(reading.area) }
  }

  function dismissChorus(): void {
    dismissedId = duplicate?.id ?? null
    inputEl?.focus()
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
    inputEl?.focus()
  }

  function cycleKind(): void {
    reading = { ...reading, kind: nextKind(reading.kind) }
  }

  async function submit(): Promise<void> {
    if (!shareable) return
    const landed = await onshare({ text: text.trim(), kind: reading.kind, area: reading.area })
    if (landed) reset()
  }
</script>

<div
  class="sticky bottom-[calc(var(--bottom-nav,calc(62px+env(safe-area-inset-bottom,0px)))+22px)] z-[4] w-[min(700px,calc(100vw-64px))] max-[640px]:w-[calc(100vw-44px)] mx-auto mt-6 animate-[fade-in_0.9s_var(--ease)_0.08s_both] motion-reduce:[animation-duration:0.01ms]"
>
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
            {duplicate.voices}
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
              {duplicate.mine ? betterCopy.alreadyVoted : betterCopy.voteInstead}
            </button>
            <button
              class="p-0 border-0 bg-transparent [font:inherit] text-sm text-ink-2 transition-colors duration-300 ease-settle cursor-pointer pointer-fine:hover:text-ink"
              type="button"
              onclick={dismissChorus}
            >
              {betterCopy.minesDifferent}
            </button>
          </div>
        </div>
      {/if}
    </div>
  </div>

  <!-- the reading: a manual chooser, both underlined words cycle on tap -->
  <div
    class={["flex items-center gap-2 h-0 overflow-hidden text-sm text-ink-3 opacity-0 [transition:height_0.5s_var(--ease),margin_0.5s_var(--ease),opacity_0.5s_var(--ease)] [&_.spinner]:shrink-0 [&_.spinner]:size-5", hasText && 'h-[22px] mb-2 opacity-100']}
    aria-live="polite"
  >
    <MeshSpinner size={20} working={false} />
    <span class="animate-[fade_0.5s_var(--ease)_both] motion-reduce:[animation-duration:0.01ms]">
      {m.capture_reading_sounds_like()}
      <button
        class="p-0 border-0 border-b border-dashed border-ink-4 bg-transparent text-ink leading-[1.25] [font:inherit] cursor-pointer [transition:border-color_0.3s_var(--ease),color_0.3s_var(--ease)] pointer-fine:hover:text-ink pointer-fine:hover:border-signal"
        type="button"
        onclick={cycleKind}>{kindPhrase(reading.kind)}</button
      >
      {betterCopy.readingIn}
      <button
        class="p-0 border-0 border-b border-dashed border-ink-4 bg-transparent text-ink leading-[1.25] [font:inherit] cursor-pointer [transition:border-color_0.3s_var(--ease),color_0.3s_var(--ease)] pointer-fine:hover:text-ink pointer-fine:hover:border-signal"
        type="button"
        onclick={cycleArea}>{areaPhrase(reading.area)}</button
      >
    </span>
  </div>

  <div class="flex items-end gap-3.5">
    <textarea
      bind:this={inputEl}
      bind:value={text}
      class="block flex-1 [field-sizing:content] max-h-40 overflow-y-auto pt-[3px] pb-1 border-0 outline-none resize-none bg-transparent font-you text-[21px] leading-[1.3] tracking-normal text-ink caret-signal placeholder:text-ink-3"
      rows="1"
      maxlength={maxLength}
      placeholder={m.better_composer_placeholder()}
      aria-label={m.better_composer_placeholder()}
      autocomplete="off"
      spellcheck="false"
      onkeydown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault()
          void submit()
        }
      }}></textarea>
    <button
      class={["shrink-0 inline-flex items-center gap-2.5 h-[34px] pl-[17px] border-0 rounded-full bg-ink text-sm text-paper [transition:opacity_0.4s_var(--ease),transform_0.5s_var(--ease)] pointer-fine:enabled:hover:-translate-y-px hover-none:[&_kbd]:hidden", hasText ? (shareable ? 'cursor-pointer pr-2' : 'opacity-50 cursor-not-allowed pr-2 max-[640px]:pr-[17px]') : 'opacity-0 -translate-x-1.5 pointer-events-none cursor-default pr-2 max-[640px]:pr-[17px]']}
      type="button"
      disabled={!shareable}
      onclick={() => void submit()}
    >
      {m.better_share()}
      <kbd class="text-inherit shadow-[inset_0_0_0_1px_currentColor] opacity-70" aria-hidden="true">↵</kbd>
    </button>
  </div>
</div>

