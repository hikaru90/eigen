<script lang="ts">
  import type { BoardIdea, BoardPerson } from './board-types'
  import { relativeDayLabel } from '$lib/chat/relative-day'
  import { getLocale } from '$lib/paraglide/runtime'
  import { betterCopy } from './better-copy'
  import { STAGE_DOTS, stageOf } from './board-tabs'
  import { areaLabel, kindLabel, statusLabel } from './labels'

  /**
   * One request on the board (ei app.js:1558-1579 `ideaHTML`, styles.css .idea).
   * Reddit-style vote control on the left — an up arrow above the score, no box,
   * clay when yours — then the words in the asker's voice, the mesh's label (Idea /
   * Bug / Polish), the area, who asked, when, four dots for how far it has come,
   * a note from the makers, and on shipped rows the thanks line. Rows never open on
   * tap; the vote control is the one target.
   */
  type Props = {
    idea: BoardIdea
    people: Readonly<Record<string, BoardPerson>>
    /** The top requested idea (DESIGN.md "The top idea is marked Most wanted"). */
    mostWanted?: boolean
    /** A clay wash that fades: the row you just shared or voted for from the chorus. */
    flash?: boolean
    /** Stagger index for the settle-in (capped like ei's `--i`). */
    index?: number
    /** Tap to vote or take it back. The button is passed so the page can fly the dot. */
    onvote?: (id: string, button: HTMLButtonElement) => void
  }

  let { idea, people, mostWanted = false, flash = false, index = 0, onvote }: Props = $props()

  const DAY_MS = 86_400_000
  const shipped = $derived(idea.status === 'shipped')
  const stage = $derived(stageOf(idea))
  const yours = $derived(!!idea.mine || !!idea.own)
  const nameOf = (who: string): string =>
    who === 'you' ? betterCopy.you : (people[who]?.name ?? who)
  const askedAgo = $derived(
    relativeDayLabel(
      new Date(Date.now() - idea.daysAgo * DAY_MS).toISOString(),
      new Date(),
      getLocale(),
    ),
  )
  const shippedAgo = $derived(
    relativeDayLabel(
      new Date(Date.now() - (idea.shippedDaysAgo ?? 0) * DAY_MS).toISOString(),
      new Date(),
      getLocale(),
    ),
  )
  /** Everyone but the asker and you (ei app.js:1560). */
  const others = $derived(Math.max(0, idea.voices - 1 - (idea.mine ? 1 : 0)))
  /** A few faces behind a shipped row's thanks (ei app.js:1561): three other people. */
  const backers = $derived(
    Object.keys(people)
      .filter((p) => p !== idea.by)
      .slice(0, 3),
  )
  const voteLabel = $derived(
    `${idea.voices} ${betterCopy.votes}${idea.mine ? `, ${betterCopy.includingYours}` : ''}. ${
      idea.mine ? betterCopy.takeVoteBack : betterCopy.voteForThis
    }`,
  )

  // Reddit-style avatar chips: tinted per person; yours is the clay outline
  const av =
    'inline-grid place-items-center shrink-0 size-[18px] rounded-full bg-[var(--tint,var(--clay))] text-white text-sm font-medium shadow-[0_0_0_2px_var(--paper)]'
  const avYou =
    'inline-grid place-items-center shrink-0 size-[18px] rounded-full bg-transparent text-white text-sm font-medium shadow-[inset_0_0_0_1.3px_var(--clay),0_0_0_2px_var(--paper)]'
</script>

<article
  class={[
    'relative isolate grid grid-cols-[54px_minmax(0,1fr)] gap-5 py-[22px] border-b border-line animate-[rise_0.8s_var(--ease)_both] [animation-delay:calc(var(--i,0)*50ms)] max-[640px]:grid-cols-[46px_minmax(0,1fr)] max-[640px]:gap-3.5',
    flash &&
      'before:absolute before:inset-[6px_-16px] before:-z-10 before:rounded-[18px] before:bg-clay-2 before:content-[""] before:[animation:flash_2.8s_var(--ease)_forwards]',
  ]}
  style="--i:{Math.min(index, 10)}"
  data-testid="idea-{idea.id}"
>
  <button
    class="flex flex-col items-center justify-start gap-0.5 w-[54px] max-[640px]:w-[46px] pt-0.5 [transition:color_0.3s_var(--ease),transform_0.5s_var(--ease)] enabled:active:scale-[0.92] disabled:cursor-default pointer-fine:enabled:hover:text-clay"
    class:text-clay={yours}
    type="button"
    disabled={shipped || !!idea.own}
    aria-pressed={!!idea.mine}
    aria-label={voteLabel}
    onclick={(e) => onvote?.(idea.id, e.currentTarget)}
  >
    <svg
      class="size-[22px] fill-none stroke-current [stroke-width:1.3] [stroke-linejoin:round] [transition:fill_0.25s_var(--ease),stroke_0.25s_var(--ease)]"
      class:fill-clay={yours}
      class:stroke-clay={yours}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <path d="M8 3.2 13 9.4H10.1V13H5.9V9.4H3Z" />
    </svg>
    <span
      class="block text-sm font-medium tracking-[-0.01em] [font-variant-numeric:tabular-nums] transition-colors duration-[250ms] ease-settle"
      class:text-clay={yours}
      >{idea.voices}</span
    >
  </button>

  <div>
    {#if mostWanted}
      <span
        class="inline-flex items-center gap-1.5 mb-1 text-sm text-clay before:content-[''] before:size-[5px] before:rounded-full before:bg-clay"
        >{betterCopy.mostWanted}</span
      >
    {/if}
    <h3
      class="m-0 font-you font-normal text-[24px] leading-[1.22] tracking-[-0.008em] text-pretty text-ink"
    >
      {idea.title}
    </h3>
    <div class="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 mt-2 text-sm text-ink-3">
      <span
        class="inline-flex items-center gap-1.5 text-ink-2 before:content-[''] before:size-[5px] before:rounded-full before:bg-signal"
        >{kindLabel(idea.kind)}</span
      >
      <span>{areaLabel(idea.area)}</span>
      <span class="inline-flex items-center gap-[7px]">
        {#if idea.by === 'you'}
          <span class={avYou} aria-hidden="true"></span>
        {:else}
          <span class={av} style="--tint:{people[idea.by]?.tint}" aria-hidden="true"
            >{nameOf(idea.by)[0]}</span
          >
        {/if}
        {nameOf(idea.by)}
      </span>
      <span>{shipped ? `${statusLabel('shipped')} · ${shippedAgo}` : askedAgo}</span>
      <span class="inline-flex items-center gap-1">
        {#each { length: STAGE_DOTS } as _, k (k)}
          <i class={['size-1 rounded-full bg-ink-4 last:mr-1', k < stage && 'bg-ink-2']}></i>
        {/each}
        {statusLabel(idea.status)}
      </span>
    </div>

    {#if idea.note}
      <p class="mt-3 mb-0 py-0.5 pl-[13px] border-l-[1.5px] border-line text-sm leading-[1.5] text-ink-2">
        <span class="block mb-px text-sm text-ink-3">{betterCopy.fromTheMakers}</span>{idea.note}
      </p>
    {/if}

    {#if shipped}
      <p class="flex items-center gap-2 mt-3 mb-0 text-sm text-ink-2">
        <span class="inline-flex [&_.av]:-ml-[5px] [&_.av:first-child]:ml-0" aria-hidden="true">
          {#if idea.by === 'you'}
            <span class={avYou}></span>
          {:else}
            <span class={av} style="--tint:{people[idea.by]?.tint}">{nameOf(idea.by)[0]}</span>
          {/if}
          {#each backers as who (who)}
            <span class={av} style="--tint:{people[who].tint}">{people[who].name[0]}</span>
          {/each}
        </span>
        <span>
          {betterCopy.thanksTo}
          {nameOf(idea.by)}{#if idea.mine}, <b class="font-medium text-clay">{betterCopy.you}</b>,{/if}
          {betterCopy.and}
          {others}
          {betterCopy.others}
        </span>
      </p>
    {/if}
    {#if shipped && idea.mine}
      <p
        class="flex items-center gap-2 mt-3 mb-0 text-sm text-clay before:shrink-0 before:content-[''] before:size-[5px] before:rounded-full before:bg-clay"
      >
        {betterCopy.youAsked}
      </p>
    {/if}
    {#if idea.own}
      <p
        class="flex items-center gap-2 mt-3 mb-0 text-sm text-clay before:shrink-0 before:content-[''] before:size-[5px] before:rounded-full before:bg-clay"
      >
        {betterCopy.sharedByYou}
      </p>
    {/if}
  </div>
</article>

