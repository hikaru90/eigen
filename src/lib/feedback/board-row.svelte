<script lang="ts">
  import type { BoardArea, BoardIdea, BoardKind, VoteDirection } from './board-types'
  import { relativeDayLabel } from '$lib/chat/relative-day'
  import { hapticPress } from '$lib/haptics'
  import { getLocale } from '$lib/paraglide/runtime'
  import { betterCopy } from './better-copy'
  import { STAGE_DOTS, stageOf } from './board-tabs'
  import { areaLabel, kindLabel, statusLabel } from './labels'
  import { nextArea, nextKind } from './share-composer'
  import { canVote } from './votes'

  /**
   * One request on the shared board (ei app.js:1558-1579 `ideaHTML`). Reddit-style
   * vote control on the left — up arrow, net score, down arrow, clay when yours —
   * then the words in the asker's voice, the judge's label (Idea / Bug / Polish),
   * the area, who asked ("Noor K."), when, four dots for how far it has come, and a
   * note from the makers. On your own Requested row the kind and area are tap-to-
   * correct and "Forget this idea" removes it. Long titles clamp to three lines and
   * open on tap. The makers (admins) can reword or delete any row.
   */
  type Props = {
    idea: BoardIdea
    /** The top requested idea (DESIGN.md "The top idea is marked Most wanted"). */
    mostWanted?: boolean
    /** A clay wash that fades: the row you just shared or voted for from the chorus. */
    flash?: boolean
    /** Stagger index for the settle-in (capped like ei's `--i`). */
    index?: number
    /** A write for this row is in flight — controls wait. */
    pending?: boolean
    /** Tap up or down to vote; the same direction again takes it back. */
    onvote?: (id: string, direction: VoteDirection, button: HTMLButtonElement) => void
    /** Author correction of the judge's reading (Requested only). */
    oncorrect?: (id: string, patch: { kind?: BoardKind; area?: BoardArea }) => void
    /** Author delete (Requested only). */
    onforget?: (id: string) => void
    /** The viewer is a maker: Edit and Delete on every row. */
    admin?: boolean
    /** Makers: save a new title. Resolves true when it landed. */
    onedit?: (id: string, title: string) => Promise<boolean>
    /** Makers: ask to delete (the page confirms). */
    ondelete?: (id: string) => void
  }

  let {
    idea,
    mostWanted = false,
    flash = false,
    index = 0,
    pending = false,
    onvote,
    oncorrect,
    onforget,
    admin = false,
    onedit,
    ondelete,
  }: Props = $props()

  let expanded = $state(false)
  /** The makers' draft while rewording; null when not editing. */
  let draft = $state<string | null>(null)

  async function saveEdit(): Promise<void> {
    const title = draft?.trim()
    if (!title || !onedit) return
    if (title === idea.title) {
      draft = null
      return
    }
    if (await onedit(idea.id, title)) draft = null
  }

  const shipped = $derived(idea.status === 'shipped')
  const editable = $derived(idea.own && idea.status === 'requested')
  const stage = $derived(stageOf(idea))
  const up = $derived(idea.myVote === 1)
  const down = $derived(idea.myVote === -1)
  const authorName = $derived(idea.author ? (idea.author.isYou ? betterCopy.you : idea.author.display) : null)
  const askedAgo = $derived(relativeDayLabel(idea.createdAt, new Date(), getLocale()))
  const shippedAgo = $derived(
    idea.shippedAt ? relativeDayLabel(idea.shippedAt, new Date(), getLocale()) : '',
  )
  /** Everyone but the asker and you. */
  const others = $derived(Math.max(0, idea.score - 1 - (up && !idea.own ? 1 : 0)))
  /** One colour per kind: ideas the signal blue, bugs warn red, polish the mesh green. */
  const kindDot: Record<BoardIdea['kind'], string> = {
    idea: 'before:bg-signal',
    bug: 'before:bg-warn',
    polish: 'before:bg-yarn-mesh',
  }
  const upLabel = $derived(up ? betterCopy.takeVoteBack : betterCopy.voteUp)
  const downLabel = $derived(down ? betterCopy.takeVoteBack : betterCopy.voteDown)
  const voteBtn =
    'grid place-items-center size-7 rounded-full [transition:color_0.3s_var(--ease),transform_0.5s_var(--ease)] enabled:active:scale-[0.9] disabled:cursor-default disabled:opacity-60 pointer-fine:enabled:hover:text-clay'
  const arrow =
    'size-[20px] stroke-current [stroke-width:1.3] [stroke-linejoin:round] [transition:fill_0.25s_var(--ease),stroke_0.25s_var(--ease)]'
  const av =
    'inline-grid place-items-center shrink-0 size-[18px] rounded-full bg-clay text-white text-sm font-medium shadow-[0_0_0_2px_var(--paper)]'
  const avYou =
    'inline-grid place-items-center shrink-0 size-[18px] rounded-full bg-transparent text-white text-sm font-medium shadow-[inset_0_0_0_1.3px_var(--clay),0_0_0_2px_var(--paper)]'
  const correctBtn =
    'p-0 border-0 border-b border-dashed border-ink-4 bg-transparent [font:inherit] text-inherit cursor-pointer [transition:border-color_0.3s_var(--ease),color_0.3s_var(--ease)] pointer-fine:hover:text-ink pointer-fine:hover:border-signal disabled:cursor-default'
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
  <div
    class="flex flex-col items-center justify-start w-[54px] max-[640px]:w-[46px] -mt-1"
    role="group"
    aria-label="{idea.score} {betterCopy.votes}"
  >
    <button
      class={[voteBtn, up && 'text-clay']}
      type="button"
      disabled={pending || !canVote(idea, 1)}
      aria-pressed={up}
      aria-label={upLabel}
      onclick={(e) => {
        hapticPress()
        onvote?.(idea.id, 1, e.currentTarget)
      }}
    >
      <svg class={[arrow, up ? 'fill-clay stroke-clay' : 'fill-none']} viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 3.2 13 9.4H10.1V13H5.9V9.4H3Z" />
      </svg>
    </button>
    <span
      class={['v-n block text-sm font-medium tracking-[-0.01em] [font-variant-numeric:tabular-nums] transition-colors duration-[250ms] ease-settle', up && 'text-clay', down && 'text-ink-3']}
      >{idea.score}</span
    >
    <button
      class={[voteBtn, down && 'text-ink']}
      type="button"
      disabled={pending || !canVote(idea, -1)}
      aria-pressed={down}
      aria-label={downLabel}
      onclick={(e) => {
        hapticPress()
        onvote?.(idea.id, -1, e.currentTarget)
      }}
    >
      <svg class={[arrow, 'rotate-180', down ? 'fill-ink stroke-ink' : 'fill-none']} viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 3.2 13 9.4H10.1V13H5.9V9.4H3Z" />
      </svg>
    </button>
  </div>

  <div>
    {#if mostWanted}
      <span
        class="inline-flex items-center gap-1.5 mb-1 text-sm text-clay before:content-[''] before:size-[5px] before:rounded-full before:bg-clay"
        >{betterCopy.mostWanted}</span
      >
    {/if}
    {#if draft !== null}
      <textarea
        class="block w-full min-h-[90px] p-3 rounded-[12px] border border-line bg-paper-2 font-you text-[20px] leading-[1.3] text-ink outline-none resize-y focus:border-signal"
        bind:value={draft}
        aria-label={betterCopy.adminEdit}
        disabled={pending}
        onkeydown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            draft = null
          }
        }}
      ></textarea>
      <div class="flex items-center gap-4 mt-2 text-sm">
        <button
          class="h-[30px] px-3.5 rounded-full border-0 bg-ink text-paper cursor-pointer disabled:opacity-40 disabled:cursor-default"
          type="button"
          disabled={pending || !draft.trim()}
          onclick={() => void saveEdit()}>{betterCopy.adminSave}</button
        >
        <button
          class="p-0 border-0 bg-transparent [font:inherit] text-ink-3 cursor-pointer pointer-fine:hover:text-ink"
          type="button"
          onclick={() => (draft = null)}>{betterCopy.adminCancel}</button
        >
      </div>
    {:else}
      <!-- long requests clamp to three lines; tap to read all of it -->
      <h3
        class="m-0 font-you font-normal text-[24px] leading-[1.22] tracking-[-0.008em] text-pretty text-ink break-words"
      >
        <button
          class={[
            'w-full p-0 border-0 bg-transparent [font:inherit] text-left text-inherit cursor-pointer',
            expanded ? 'block' : 'line-clamp-3',
          ]}
          data-testid="idea-title"
          type="button"
          aria-expanded={expanded}
          onclick={() => (expanded = !expanded)}>{idea.title}</button
        >
      </h3>
    {/if}
    <div class="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 mt-2 text-sm text-ink-3">
      <span
        class={['inline-flex items-center gap-1.5 text-ink-2 before:content-[""] before:size-[5px] before:rounded-full', kindDot[idea.kind]]}
      >
        {#if editable}
          <button
            class={correctBtn}
            type="button"
            disabled={pending}
            title={betterCopy.correctHint}
            onclick={() => oncorrect?.(idea.id, { kind: nextKind(idea.kind) })}>{kindLabel(idea.kind)}</button
          >
        {:else}
          {kindLabel(idea.kind)}
        {/if}
      </span>
      {#if editable}
        <button
          class={correctBtn}
          type="button"
          disabled={pending}
          title={betterCopy.correctHint}
          onclick={() => oncorrect?.(idea.id, { area: nextArea(idea.area) })}>{areaLabel(idea.area)}</button
        >
      {:else}
        <span>{areaLabel(idea.area)}</span>
      {/if}
      {#if idea.author && authorName}
        <span class="inline-flex items-center gap-[7px]">
          {#if idea.author.isYou}
            <span class={avYou} aria-hidden="true"></span>
          {:else}
            <span class={av} aria-hidden="true">{Array.from(idea.author.display)[0]}</span>
          {/if}
          {authorName}
        </span>
      {/if}
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
        <span>
          {betterCopy.thanksTo}
          {authorName ?? betterCopy.others}{#if up && !idea.own}, <b class="font-medium text-clay">{betterCopy.you}</b>,{/if}
          {betterCopy.and}
          {others}
          {betterCopy.others}
        </span>
      </p>
    {/if}
    {#if admin && draft === null}
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-sm" data-testid="idea-admin">
        <button
          class="p-0 border-0 bg-transparent [font:inherit] text-ink-3 cursor-pointer transition-colors duration-300 ease-settle pointer-fine:hover:text-ink disabled:cursor-default"
          type="button"
          disabled={pending}
          onclick={() => (draft = idea.title)}>{betterCopy.adminEdit}</button
        >
        <button
          class="p-0 border-0 bg-transparent [font:inherit] text-ink-3 cursor-pointer transition-colors duration-300 ease-settle pointer-fine:hover:text-warn disabled:cursor-default"
          type="button"
          disabled={pending}
          onclick={() => ondelete?.(idea.id)}>{betterCopy.adminDelete}</button
        >
      </div>
    {/if}
    {#if idea.own}
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-sm">
        <p
          class="flex items-center gap-2 m-0 text-clay before:shrink-0 before:content-[''] before:size-[5px] before:rounded-full before:bg-clay"
        >
          {betterCopy.sharedByYou}
        </p>
        {#if editable}
          <button
            class="p-0 border-0 bg-transparent [font:inherit] text-ink-3 cursor-pointer transition-colors duration-300 ease-settle pointer-fine:hover:text-ink disabled:cursor-default"
            type="button"
            disabled={pending}
            onclick={() => onforget?.(idea.id)}>{betterCopy.forget}</button
          >
        {/if}
      </div>
    {/if}
  </div>
</article>
