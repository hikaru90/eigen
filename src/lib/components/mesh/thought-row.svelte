<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { ResolvedPathname } from '$app/types'
  import {
    pillAction,
    pillData,
    pillThreadText,
    pillTypeText,
  } from '$lib/components/mesh/pill-classes'

  /**
   * One thought on the strand — shared by Yarn and Threads. A design-studio
   * "project index" row: the words on their own (tick ring for to-dos, three
   * lines at most), and under them one wrapping line of pill-shaped objects
   * beside a thin bar: time → type → thread → edit → related thoughts. The
   * related-thoughts pill (only when there are some) toggles a list of them in
   * the flow right under the pill line; each links to its own thought page.
   *
   * Prop-driven and dependency-light on purpose: no `$app/*`, no paraglide —
   * the caller formats labels and owns what the controls do. The `editor`
   * snippet renders inside the pill line (type, thread and "edit words" pills;
   * its words field opens on its own line under the pills) and replaces the
   * plain `kindLabel` / `threadLabel` data pills, which only rows without an
   * editor show.
   */
  type Props = {
    thoughtId: string
    text: string
    /** Preformatted by the caller: a clock (HH:MM) on Yarn, a day label in a thread. */
    timeLabel: string
    /** Stagger position for the settle-in rise, capped at 14 like ei. */
    index?: number
    /** Fresh signal dot, inside the time pill: a thought captured moments ago. */
    fresh?: boolean
    /** Crossed out — the thought's lifecycle is completed. */
    done?: boolean
    /** To-dos only: the small ring in front of the words. */
    showTick?: boolean
    tickLabel?: string
    /** Label of the "related thoughts" pill (shown only when `related` is non-empty). */
    relatedLabel?: string
    /** Nearest thoughts, already formatted by the caller: text, a muted date, a link. */
    related?: { id: string; text: string; dateLabel: string; href: ResolvedPathname }[]
    kindLabel?: string | null
    threadLabel?: string | null
    ontoggle?: () => void
    /** The type, thread and edit-words pills (and the words field), inline in the pill line. */
    editor?: Snippet
  }

  let {
    thoughtId,
    text,
    timeLabel,
    index = 0,
    fresh = false,
    done = false,
    showTick = false,
    tickLabel = '',
    relatedLabel = '',
    related = [],
    kindLabel = null,
    threadLabel = null,
    ontoggle,
    editor,
  }: Props = $props()

  let relatedOpen = $state(false)
  let expanded = $state(false)
  /** The words run past three lines (measured while clamped); only then are they tappable. */
  let overflowing = $state(false)
  const toggleable = $derived(overflowing || expanded)

  /** Measures the clamped paragraph on mount and on resize; skipped while expanded. */
  function measureClamp(node: HTMLElement) {
    const measure = () => {
      if (expanded) return
      overflowing = node.scrollHeight > node.clientHeight + 1
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return { destroy: () => observer.disconnect() }
  }

  function toggleWords() {
    if (toggleable) expanded = !expanded
  }
  function onWordsKey(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggleWords()
    }
  }
</script>

<article
  class="relative py-1 animate-[rise_0.8s_var(--ease)_both] [animation-delay:calc(var(--i,0)*28ms)]"
  class:is-fresh={fresh}
  class:is-done={done}
  data-thought-id={thoughtId}
  data-testid={'thought-' + thoughtId}
  style:--i={Math.min(index, 14)}
>
  <p
    class="font-you text-[23px] leading-[1.15] tracking-[-0.006em] text-pretty [overflow-wrap:anywhere] transition-colors duration-500 ease-settle"
    class:line-clamp-3={!expanded}
    use:measureClamp
    data-testid="thought-row-text"
    class:text-ink-3={done}
    class:line-through={done}
    class:decoration-ink-4={done}
    class:decoration-1={done}
  >
    {#if showTick}
      <button
        class={[
          'relative mr-2.5 inline-block size-[15px] rounded-full align-[0.02em] [transition:box-shadow_0.3s_var(--ease),background_0.4s_var(--ease)] before:absolute before:-inset-3 before:content-[""] after:absolute after:left-[5px] after:top-[2.5px] after:h-[7px] after:w-[3.5px] after:rotate-45 after:border-r-[1.5px] after:border-b-[1.5px] after:border-paper after:content-[""] pointer-fine:hover:shadow-[inset_0_0_0_1.3px_var(--ink)]',
          done
            ? 'bg-ink-2 shadow-none after:scale-100'
            : 'shadow-[inset_0_0_0_1.3px_var(--ink-3)] after:scale-0',
        ]}
        type="button"
        aria-pressed={done}
        aria-label={tickLabel}
        onclick={() => ontoggle?.()}
      ></button>
    {/if}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <span
      class={toggleable ? 'cursor-pointer' : undefined}
      data-testid="thought-row-words"
      role={toggleable ? 'button' : undefined}
      tabindex={toggleable ? 0 : undefined}
      aria-expanded={toggleable ? expanded : undefined}
      onclick={toggleWords}
      onkeydown={toggleable ? onWordsKey : undefined}>{text}</span
    >
  </p>
  <div
    class="mt-1 flex flex-wrap items-center gap-1 border-l-[3px] border-ink-4 py-[2px] pl-2"
    data-testid="thought-row-pills"
  >
    <time class={[pillData, 'font-you tabular-nums']} data-testid="thought-row-time">
      {#if fresh}<span
          class="size-[5px] rounded-full bg-signal [animation:fade_0.6s_var(--ease)_both_reverse_4s]"
          data-testid="thought-row-fresh"
          aria-hidden="true"
        ></span>{/if}{timeLabel}</time
    >
    {#if editor}
      {@render editor()}
    {:else}
      {#if kindLabel}<span class={pillTypeText} data-testid="thought-row-pill">{kindLabel}</span
        >{/if}
      {#if threadLabel}<span class={pillThreadText} data-testid="thought-row-pill"
          >{threadLabel}</span
        >{/if}
    {/if}
    {#if related.length > 0}
      <button
        class={pillAction}
        type="button"
        data-testid="thought-row-related-toggle"
        aria-expanded={relatedOpen}
        aria-controls={'related-' + thoughtId}
        onclick={() => (relatedOpen = !relatedOpen)}
      >
        {relatedLabel}
        <svg
          class={[
            'size-[9px] fill-none stroke-current [stroke-width:1.5] [stroke-linecap:round] [stroke-linejoin:round] [transition:transform_0.4s_var(--ease)]',
            relatedOpen && 'rotate-180',
          ]}
          viewBox="0 0 16 16"
          aria-hidden="true"
          data-testid="thought-row-related-chevron"
        >
          <path d="M4 6.25 8 10.25l4-4" />
        </svg>
      </button>
    {/if}
  </div>
  {#if relatedOpen && related.length > 0}
    <ul
      class="mt-2 flex list-none flex-col gap-2 p-0"
      id={'related-' + thoughtId}
      data-testid="thought-row-related"
    >
      {#each related as item (item.id)}
        <li>
          <a
            class="block text-ink-2 no-underline [transition:color_0.3s_var(--ease)] pointer-fine:hover:text-ink"
            href={item.href}
            data-testid="thought-row-related-item"
          >
            <span class="line-clamp-2 font-you text-[16px] leading-[1.25]">{item.text}</span>
            <small class="mt-0.5 block font-mesh text-[11px] text-ink-3">{item.dateLabel}</small>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</article>
