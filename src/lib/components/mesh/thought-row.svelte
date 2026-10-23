<script lang="ts">
  /**
   * One thought on the strand — shared by Yarn now, Threads and the thought
   * page later (ei redesign, wave 2.2). Ported from ei app.js:737-742 and ei
   * styles.css `.thought`.
   *
   * Prop-driven and dependency-light on purpose: no `$app/*`, no paraglide —
   * the caller formats labels and owns what the controls do. Rows never open
   * on tap (DESIGN.md "Lists are for reading"); the open control is the one
   * way in, and the tick ring appears only for to-dos.
   */
  type Props = {
    thoughtId: string
    text: string
    /** Locale-formatted local clock time (HH:MM) — preformatted by the caller. */
    timeLabel: string
    /**
     * Dated rows (ei app.js:737 `dated`): inside a thread the time column holds
     * a day ("Yesterday", "2 Oct") instead of a clock, so it gets more room.
     */
    dated?: boolean
    /** Stagger position for the settle-in rise, capped at 14 like ei. */
    index?: number
    /** Fresh signal dot: a thought captured moments ago. */
    fresh?: boolean
    /** Crossed out — the thought's lifecycle is completed. */
    done?: boolean
    /** To-dos only: the small ring in front of the words. */
    showTick?: boolean
    tickLabel?: string
    /** Aria label for the explicit open control (two corner arrows). */
    openLabel: string
    kindLabel?: string | null
    threadLabel?: string | null
    ontoggle?: () => void
    onopen: () => void
  }

  let {
    thoughtId,
    text,
    timeLabel,
    dated = false,
    index = 0,
    fresh = false,
    done = false,
    showTick = false,
    tickLabel = '',
    openLabel,
    kindLabel = null,
    threadLabel = null,
    ontoggle,
    onopen,
  }: Props = $props()

  /* ei grid: time · words · meta · open (dated rows widen the time column). */
  const rowGrid = $derived(
    dated
      ? 'grid-cols-[70px_minmax(0,1fr)_auto_auto] max-[640px]:grid-cols-[minmax(0,1fr)_auto]'
      : 'grid-cols-[46px_minmax(0,1fr)_auto_auto] max-[640px]:grid-cols-[minmax(0,1fr)_auto]',
  )
</script>

<!--
  The negative margins widen the row's paint area inside the padded stream,
  exactly like the prototype.
-->
<article
  class={[
    'relative grid w-[calc(100%+28px)] -mx-3.5 items-baseline gap-x-[18px] rounded-[14px] p-3.5 animate-[rise_0.8s_var(--ease)_both] [animation-delay:calc(var(--i,0)*28ms)]',
    rowGrid,
  ]}
  class:is-fresh={fresh}
  data-thought-id={thoughtId}
  data-testid={'thought-' + thoughtId}
  style:--i={Math.min(index, 14)}
>
  <time
    class={[
      'relative col-start-1 text-sm text-ink-3 [font-variant-numeric:tabular-nums]',
      fresh &&
        'before:absolute before:-left-[13px] before:top-1/2 before:mt-[-3px] before:size-[5px] before:rounded-full before:bg-signal before:content-[""] before:[animation:fade_0.6s_var(--ease)_both_reverse_4s]',
    ]}
    >{timeLabel}</time
  >

  <p
    class="font-you text-[23px] leading-[1.27] tracking-[-0.006em] text-pretty transition-colors duration-500 ease-settle max-[640px]:col-start-1"
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
    {text}
  </p>
  {#if kindLabel || threadLabel}
    <span
      class="inline-flex items-baseline gap-2.5 font-you text-base text-ink-3 whitespace-nowrap max-[640px]:col-start-1 max-[640px]:justify-self-start max-[640px]:mt-1"
    >
      {#if kindLabel}
        <span
          class="font-mesh text-sm text-ink-3 before:mr-1.5 before:mb-0.5 before:inline-block before:size-1 before:rounded-full before:bg-signal before:content-['']"
          >{kindLabel}</span
        >
      {/if}
      {#if threadLabel}<span class="thread">{threadLabel}</span>{/if}
    </span>
  {/if}
  <button
    class="relative grid size-6 place-items-center -mt-px -mr-1 rounded-full self-start text-ink-3 transition-colors duration-300 ease-settle before:absolute before:-inset-2 before:content-[''] pointer-fine:hover:text-ink max-[640px]:col-start-2 max-[640px]:row-start-1 max-[640px]:justify-self-end"
    type="button"
    aria-label={openLabel}
    onclick={() => onopen()}
  >
    <svg
      class="size-[13px] fill-none stroke-current [stroke-width:1.3] [stroke-linecap:round] [stroke-linejoin:round]"
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <path d="M9.5 3.5h3v3M6.5 12.5h-3v-3M12.5 3.5 9.2 6.8M3.5 12.5l3.3-3.3" />
    </svg>
  </button>
</article>
