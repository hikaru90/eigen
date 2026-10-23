<script module lang="ts">
  /** The welcome note shows once per app session (ei app.js:1629 `shipSeen`). */
  let welcomeSeen = false
</script>

<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { resolve } from '$app/paths'
  import { clearFeedbackNote } from '$lib/components/chrome/feedback-news.svelte'
  import { betterCopy } from '$lib/feedback/better-copy'
  import BoardRow from '$lib/feedback/board-row.svelte'
  import {
    BOARD_TABS,
    matchesBoardQuery,
    mostWantedId,
    sortForTab,
    tabCounts,
    type BoardTab,
  } from '$lib/feedback/board-tabs'
  import type { BoardArea, BoardIdea, BoardKind } from '$lib/feedback/board-types'
  import { FEEDBACK_MAX_LENGTH } from '$lib/feedback/feedback-max-length'
  import { FIXTURE_BOARD_IDEAS, FIXTURE_BOARD_PEOPLE } from '$lib/feedback/fixture-board'
  import { statusLabel } from '$lib/feedback/labels'
  import ShareComposer from '$lib/feedback/share-composer.svelte'
  import {
    canLendVote,
    lendVote,
    purseDots,
    takeBackVote,
    votesLeft,
  } from '$lib/feedback/vote-purse'
  import { EASE, flyThought, prefersReducedMotion } from '$lib/motion/settle'
  import { m } from '$lib/paraglide/messages.js'

  /**
   * Make me better (DESIGN.md): ideas and bugs, shared with the makers. A full page,
   * not a drawer — "← Back" in its own row (esc too), the tabs Requested / In progress /
   * Shipped as the one tab group with counts and the search at the row's end, one line
   * about your votes, the board, and the writer docked at the bottom.
   *
   * FIXTURE THIS PASS (docs/planning/ei-redesign.md decision 4): the board rows, the
   * votes and the purse are client state seeded from `fixture-board.ts`; nothing here
   * persists a vote or reads a shared board. What IS real: sharing posts to the existing
   * `POST /api/feedback` (the makers' inbox), the header entry/glimpse/news dot, and the
   * note. The multiplayer backend is a later pass.
   */

  // ——— state: the board, seeded from the fixture ———
  let ideas = $state<readonly BoardIdea[]>(FIXTURE_BOARD_IDEAS.map((i) => ({ ...i })))
  const people = FIXTURE_BOARD_PEOPLE

  let tab = $state<BoardTab>('requested')
  /** The list lags the tab by one crossfade (ei app.js:1612-1614). */
  let shownTab = $state<BoardTab>('requested')
  let swapping = $state(false)
  let swapTimer: ReturnType<typeof setTimeout> | null = null

  let search = $state({ open: false, query: '' })
  let searchEl = $state<HTMLInputElement | null>(null)

  let note = $state<{ text: string; sticky: boolean } | null>(null)
  let noteTimer: ReturnType<typeof setTimeout> | null = null

  let flashId = $state<string | null>(null)
  let flashTimer: ReturnType<typeof setTimeout> | null = null
  let busy = $state(false)

  let segEl = $state<HTMLDivElement | null>(null)
  let purseEl = $state<HTMLDivElement | null>(null)
  let composer = $state<ShareComposer | null>(null)

  // ——— pure view state ———
  const counts = $derived(tabCounts(ideas))
  const rows = $derived(sortForTab(ideas, shownTab))
  const visibleRows = $derived(rows.filter((r) => matchesBoardQuery(r, search.query)))
  const mostWanted = $derived(mostWantedId(rows, shownTab))
  const left = $derived(votesLeft(ideas))
  const dots = $derived(purseDots(ideas))
  const noMatches = $derived(search.query.trim().length > 0 && visibleRows.length === 0)

  // ——— the note: inline at the top, never a pop-up ———
  function say(text: string, ms = 4200): void {
    if (noteTimer) clearTimeout(noteTimer)
    noteTimer = null
    note = { text, sticky: ms <= 0 }
    if (ms > 0) {
      noteTimer = setTimeout(() => {
        note = null
        noteTimer = null
      }, ms)
    }
  }
  function dismissNote(): void {
    if (noteTimer) clearTimeout(noteTimer)
    noteTimer = null
    note = null
  }

  // ——— tabs: the active tab carries the raised pill in CSS, the list crossfades ———
  function selectTab(next: BoardTab): void {
    if (next === tab) return
    tab = next
    swapping = true
    if (swapTimer) clearTimeout(swapTimer)
    swapTimer = setTimeout(
      () => {
        shownTab = next
        swapTimer = null
        requestAnimationFrame(() => {
          swapping = false
        })
      },
      prefersReducedMotion() ? 0 : 180,
    )
  }

  // ——— search: a field in the tab row, filters in place ———
  function openSearch(): void {
    search.open = true
    setTimeout(() => searchEl?.focus(), 60)
  }
  function closeSearch(): void {
    search.open = false
    search.query = ''
    searchEl?.blur()
  }

  // ——— back: history, or Capture when there is nowhere to go back to ———
  function goBack(): void {
    if (history.length > 1) history.back()
    else void goto(resolve('/capture'))
  }

  function isTyping(el: EventTarget | null): el is HTMLElement {
    if (!(el instanceof HTMLElement)) return false
    return el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.defaultPrevented) return
    if (e.key === 'Escape') {
      if (search.open) {
        closeSearch()
        return
      }
      if (isTyping(e.target)) {
        e.target.blur()
        return
      }
      goBack()
      return
    }
    // start typing anywhere and you're sharing (ei app.js:1852-1853)
    if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return
    if (e.key.length === 1 && e.key !== ' ') composer?.focus()
  }

  // ——— votes: Reddit-style, answered at once; the clay dot's flight is the echo ———
  const clayFlight = {
    color: 'var(--clay)',
    haloColor: 'var(--clay-2)',
    durationMs: 760,
  } as const

  function tickScore(button: HTMLButtonElement, dir: 1 | -1): void {
    if (prefersReducedMotion()) return
    button.querySelector<HTMLElement>('.v-n')?.animate(
      [
        { transform: `translateY(${dir * 7}px)`, opacity: 0 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 520, easing: EASE },
    )
  }

  function vote(id: string, button: HTMLButtonElement): void {
    const idea = ideas.find((i) => i.id === id)
    if (!idea) return

    if (idea.mine) {
      ideas = takeBackVote(ideas, id)
      tickScore(button, -1)
      // the dot flies home to the slot that just refilled
      const slot = purseEl?.children[votesLeft(ideas) - 1]
      if (slot) flyThought(button.getBoundingClientRect(), slot, clayFlight)
      say(betterCopy.voteTakenBack, 1500)
      return
    }

    if (!canLendVote(ideas)) {
      if (!prefersReducedMotion()) {
        button.animate(
          [
            { transform: 'translateX(0)' },
            { transform: 'translateX(-3px)' },
            { transform: 'translateX(3px)' },
            { transform: 'none' },
          ],
          { duration: 320 },
        )
      }
      say(betterCopy.votesExhausted, 3800)
      return
    }

    // the slot being lent, measured before the purse redraws
    const slot = purseEl?.children[votesLeft(ideas) - 1]
    const others = idea.voices
    ideas = lendVote(ideas, id)
    tickScore(button, 1)
    if (!prefersReducedMotion()) {
      button.animate([{ transform: 'scale(1.12)' }, { transform: 'none' }], {
        duration: 500,
        easing: EASE,
      })
    }
    if (slot) flyThought(slot.getBoundingClientRect(), button, clayFlight)
    say(betterCopy.votedWith(others), 3600)
  }

  function flash(id: string): void {
    flashId = id
    if (flashTimer) clearTimeout(flashTimer)
    flashTimer = setTimeout(() => {
      flashId = null
      flashTimer = null
    }, 2800)
    const delay = shownTab === tab ? 40 : 240
    setTimeout(() => {
      document
        .querySelector(`[data-testid="idea-${id}"]`)
        ?.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    }, delay)
  }

  /** The chorus card's "Vote for it instead": lend the vote, then show the row. */
  function voteInstead(id: string): void {
    const idea = ideas.find((i) => i.id === id)
    if (!idea) return
    if (!idea.mine) {
      if (canLendVote(ideas)) {
        const others = idea.voices
        ideas = lendVote(ideas, id)
        say(betterCopy.votedWith(others), 3600)
      } else {
        say(betterCopy.votesExhausted, 3800)
      }
    }
    selectTab(idea.status)
    flash(id)
  }

  // ——— share: the real inbox (existing endpoint) + a row on the fixture board ———
  async function share(draft: {
    text: string
    kind: BoardKind
    area: BoardArea
  }): Promise<boolean> {
    busy = true
    try {
      // Keep the existing capability: feedback reaches the makers through /api/feedback
      // (src/routes/api/feedback/+server.ts). The kind/area are fixture metadata this
      // pass and are not sent — the endpoint's contract is the message alone.
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: draft.text }),
      })
      const body: unknown = await res.json().catch(() => null)
      const bodyRec = body && typeof body === 'object' ? (body as Record<string, unknown>) : null
      if (!res.ok) {
        const reason = typeof bodyRec?.error === 'string' ? bodyRec.error : `(${res.status})`
        say(`${betterCopy.shareFailed} ${reason}`, 7000)
        return false
      }
      const id = `own-${typeof bodyRec?.id === 'string' ? bodyRec.id : Date.now()}`
      ideas = [
        {
          id,
          title: draft.text,
          kind: draft.kind,
          area: draft.area,
          by: 'you',
          daysAgo: 0,
          voices: 1,
          status: 'requested',
          own: true,
        },
        ...ideas,
      ]
      selectTab('requested')
      flash(id)
      say(betterCopy.sharedThanks, 4600)
      return true
    } finally {
      busy = false
    }
  }

  onMount(() => {
    // the clay dot's note: the app, asking — once per session, sticky until dismissed
    if (!welcomeSeen) {
      welcomeSeen = true
      say(betterCopy.welcome, 0)
    }
    // the dot clears once you've looked
    clearFeedbackNote()

    return () => {
      if (swapTimer) clearTimeout(swapTimer)
      if (noteTimer) clearTimeout(noteTimer)
      if (flashTimer) clearTimeout(flashTimer)
    }
  })
</script>

<svelte:head>
  <title>{m.nav_make_me_better()} — Eigenmesh</title>
</svelte:head>

<svelte:window onkeydown={onKeydown} />

<!-- the page's controls in flow: back row, then tabs+search; they stick under the header -->
<div
  class="sticky top-[calc(var(--head,68px)+6px)] z-30 flex flex-col items-start gap-3 w-[min(636px,calc(100vw-44px))] mx-auto mt-[calc(var(--head,68px)+6px)]"
>
  <button
    class="inline-flex items-center gap-2 py-1 border-0 bg-transparent text-sm text-ink-3 cursor-pointer transition-colors duration-300 ease-settle animate-[fade_0.6s_var(--ease)_both] pointer-fine:hover:text-ink"
    type="button"
    onclick={goBack}
  >
    <span aria-hidden="true">←</span>
    {betterCopy.back}
  </button>

  <!-- the tabs, then search, above the faded board -->
  <div class="flex items-center gap-2 -ml-[3px] max-w-full animate-[fade_0.7s_var(--ease)_0.1s_both]">
    <div
      class={`relative flex p-[3px] rounded-full bg-paper-2 whitespace-nowrap ${search.open ? 'max-[640px]:hidden' : ''}`}
      role="tablist"
      bind:this={segEl}
    >
      {#each BOARD_TABS as t (t)}
        <button
          type="button"
          role="tab"
          class={["relative px-3.5 py-1 border-0 rounded-full bg-transparent text-sm text-ink-3 cursor-pointer transition-[color,background-color] duration-[450ms] ease-settle max-[640px]:px-[11px] pointer-fine:hover:text-ink-2", tab === t ? 'text-ink bg-raised shadow-(--pill-ring)' : '']}
          aria-selected={tab === t}
          onclick={() => selectTab(t)}
        >
          {statusLabel(t)}
          <span class="ml-[3px] text-ink-3 [font-variant-numeric:tabular-nums]">{counts[t]}</span>
        </button>
      {/each}
    </div>

    <div
      class={["relative flex h-[33px] items-center rounded-full bg-paper-2", search.open ? 'pr-0.5 max-[640px]:w-[calc(100vw-44px)]' : '']}
    >
      <button
        class="grid size-[33px] place-items-center border-0 rounded-full bg-transparent text-ink-2 transition-colors duration-300 ease-settle pointer-fine:hover:text-ink"
        class:pointer-events-none={search.open}
        type="button"
        aria-label={m.yarn_search()}
        onclick={openSearch}
      >
        <svg class="size-3.5 fill-none stroke-current [stroke-width:1.4] [stroke-linecap:round]" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="7" cy="7" r="4.2" />
          <path d="m10.2 10.2 3.3 3.3" />
        </svg>
      </button>
      <input
        bind:this={searchEl}
        bind:value={search.query}
        class={["w-0 p-0 border-0 bg-transparent text-sm text-ink caret-signal outline-none opacity-0 placeholder:text-ink-3 [transition:width_0.5s_var(--ease),opacity_0.3s_var(--ease)] [&::-webkit-search-cancel-button]:hidden", search.open ? 'w-[170px] opacity-100 max-[640px]:flex-1 max-[640px]:w-auto' : '']}
        type="search"
        placeholder={m.yarn_search()}
        aria-label={m.yarn_search()}
        autocomplete="off"
        spellcheck="false"
        onkeydown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            closeSearch()
          }
        }}
      />
      <span class="text-sm text-ink-3 whitespace-nowrap empty:hidden" aria-live="polite">{noMatches ? m.yarn_no_matches() : ''}</span>
      <button
        class={["w-[30px] h-[33px] place-items-center border-0 bg-transparent text-ink-3 pointer-fine:hover:text-ink", search.open ? 'grid' : 'hidden']}
        type="button"
        aria-label={m.graph_close()}
        onclick={closeSearch}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
        </svg>
      </button>
    </div>
  </div>
</div>

<div
  class="mx-auto max-w-[700px] pt-[22px] px-8 pb-[calc(var(--bottom-nav,calc(62px+env(safe-area-inset-bottom,0px)))+220px)] max-[640px]:px-[22px]"
>
  <!-- the app's note (the clay dot's message): inline, dismissible; confirmations land here too -->
  <div
    class={["items-start gap-2.5 mb-[22px] before:shrink-0 before:content-[''] before:size-1.5 before:mt-[7px] before:rounded-full before:bg-clay", note ? 'flex animate-[fade_0.5s_var(--ease)_both]' : 'hidden']}
    role="status"
  >
    {#if note}
      <span class="flex-1 text-sm leading-[1.5] text-ink-2">{note.text}</span>
      <button
        class="relative shrink-0 grid place-items-center size-[22px] -mt-px border-0 bg-transparent text-ink-3 transition-colors duration-300 ease-settle before:absolute before:-inset-2.5 before:content-[''] pointer-fine:hover:text-ink"
        type="button"
        aria-label={m.graph_close()}
        onclick={dismissNote}
      >
        <svg class="size-3 fill-none stroke-current [stroke-width:1.4] [stroke-linecap:round]" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
        </svg>
      </button>
    {/if}
  </div>

  <!-- your votes: ten clay dots, in plain words -->
  <section class="flex items-center gap-3.5 pb-2.5" aria-label={m.better_votes_left({ count: left })}>
    <div class="shrink-0 flex flex-nowrap gap-[5px]" bind:this={purseEl} aria-hidden="true">
      {#each dots as filled, k (k)}
        <i
          class={["size-[7px] rounded-full [transition:background_0.5s_var(--ease),box-shadow_0.5s_var(--ease)]", filled ? 'bg-clay' : 'bg-transparent shadow-[inset_0_0_0_1.2px_var(--ink-4)]']}
        ></i>
      {/each}
    </div>
    <p class="m-0 text-sm leading-[1.45] text-ink-3">{m.better_votes_left({ count: left })}</p>
  </section>

  <!-- the board: one smooth crossfade of the whole list on tab change -->
  <div
    class="transition-opacity duration-300 ease-settle [&_*]:[animation:none_!important]"
    class:opacity-0={swapping}
    class:duration-[160ms]={swapping}
  >
    {#each visibleRows as idea, i (idea.id)}
      <BoardRow
        {idea}
        {people}
        index={i}
        mostWanted={idea.id === mostWanted}
        flash={idea.id === flashId}
        onvote={vote}
      />
    {/each}
    {#if noMatches}
      <p class="mt-7 mb-0 text-sm text-ink-3">{m.yarn_no_matches()}</p>
    {/if}
  </div>
</div>

<!-- the writer, always docked here; the board fades out behind it -->
<ShareComposer
  bind:this={composer}
  {ideas}
  maxLength={FEEDBACK_MAX_LENGTH}
  {busy}
  onshare={share}
  onvoteinstead={voteInstead}
/>

