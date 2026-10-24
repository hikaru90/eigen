<script lang="ts">
  import type { PageData } from './$types'
  import { onMount } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import { goto } from '$app/navigation'
  import { resolve } from '$app/paths'
  import { clearFeedbackNote } from '$lib/components/chrome/feedback-news.svelte'
  import { portal } from '$lib/components/chrome/portal'
  import * as Tabs from '$lib/components/ui/tabs'
  import { betterCopy } from '$lib/feedback/better-copy'
  import {
    BoardRequestError,
    checkIdea,
    correctIdea,
    fetchBoard,
    forgetIdea,
    shareIdea,
    voteOnIdea,
  } from '$lib/feedback/board-client'
  import BoardRow from '$lib/feedback/board-row.svelte'
  import {
    BOARD_TABS,
    matchesBoardQuery,
    mostWantedId,
    sortForTab,
    tabCounts,
    type BoardTab,
  } from '$lib/feedback/board-tabs'
  import type {
    BoardArea,
    BoardCheckResult,
    BoardIdea,
    BoardKind,
    VoteDirection,
  } from '$lib/feedback/board-types'
  import { FEEDBACK_MAX_LENGTH } from '$lib/feedback/feedback-max-length'
  import { statusLabel } from '$lib/feedback/labels'
  import ShareComposer from '$lib/feedback/share-composer.svelte'
  import { canVote, nextVoteDirection } from '$lib/feedback/votes'
  import { EASE, prefersReducedMotion } from '$lib/motion/settle'
  import { m } from '$lib/paraglide/messages.js'

  /**
   * Make me better (DESIGN.md): the shared Contribute board — one board for every
   * signed-in user (docs/planning/feature-multiplayer-board.md). A full page: the
   * intro, then the tabs Requested / In progress / Shipped with counts, the board, and
   * the writer docked at the bottom.
   *
   * Data flow (no $effect): load the board on mount; every write (vote, share,
   * correct, forget) goes to its `/api/board` endpoint, then the board is fetched
   * again. No optimistic scores — the server's numbers are the only numbers.
   */

  let { data }: { data: PageData } = $props()

  let ideas = $state<readonly BoardIdea[]>([])
  let loaded = $state(false)
  /** Rows with a write in flight; their controls wait. */
  const pendingIds = new SvelteSet<string>()

  let tab = $state<BoardTab>('requested')
  /** The list lags the tab by one crossfade (ei app.js:1612-1614). */
  let shownTab = $state<BoardTab>('requested')
  let swapping = $state(false)
  let swapTimer: ReturnType<typeof setTimeout> | null = null

  let note = $state<{ text: string; sticky: boolean } | null>(null)
  let noteTimer: ReturnType<typeof setTimeout> | null = null

  let search = $state({ open: false, query: '' })
  let searchEl = $state<HTMLInputElement | null>(null)

  let flashId = $state<string | null>(null)
  let flashTimer: ReturnType<typeof setTimeout> | null = null
  let busy = $state(false)

  let composer = $state<ShareComposer | null>(null)

  // ——— pure view state ———
  const counts = $derived(tabCounts(ideas))
  const rows = $derived(sortForTab(ideas, shownTab))
  const visibleRows = $derived(rows.filter((r) => matchesBoardQuery(r, search.query)))
  const noMatches = $derived(search.query.trim().length > 0 && visibleRows.length === 0)
  const mostWanted = $derived(mostWantedId(rows, shownTab))

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

  /** Publishes the fixed intro+tabs height (it wraps on phones) for the board's padding and fade. */
  function publishHeadHeight(node: HTMLElement) {
    const doc = document.documentElement
    const observer = new ResizeObserver(() => {
      doc.style.setProperty('--board-head-height', `${node.getBoundingClientRect().height}px`)
    })
    observer.observe(node)
    return {
      destroy() {
        observer.disconnect()
        doc.style.removeProperty('--board-head-height')
      },
    }
  }

  function reasonOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }

  function setPending(id: string, on: boolean): void {
    if (on) pendingIds.add(id)
    else pendingIds.delete(id)
  }

  // ——— the board: fetched on mount and after every write ———
  async function refresh(): Promise<boolean> {
    try {
      ideas = await fetchBoard()
      loaded = true
      return true
    } catch (err) {
      say(`${betterCopy.loadFailed} ${reasonOf(err)}`, 0)
      return false
    }
  }

  // ——— votes: Reddit-style up/down, as many as you like ———
  function tickScore(button: HTMLButtonElement, dir: VoteDirection): void {
    if (prefersReducedMotion()) return
    button.parentElement?.querySelector<HTMLElement>('.v-n')?.animate(
      [
        { transform: `translateY(${-dir * 7}px)`, opacity: 0 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 520, easing: EASE },
    )
    button.animate([{ transform: 'scale(1.12)' }, { transform: 'none' }], {
      duration: 500,
      easing: EASE,
    })
  }

  async function vote(
    id: string,
    direction: VoteDirection,
    button: HTMLButtonElement,
  ): Promise<void> {
    const idea = ideas.find((i) => i.id === id)
    if (!idea || pendingIds.has(id) || !canVote(idea, direction)) return
    const next = nextVoteDirection(idea.myVote, direction)
    setPending(id, true)
    try {
      await voteOnIdea(id, next)
      tickScore(button, direction)
      if (next === 0) say(betterCopy.voteTakenBack, 1500)
    } catch (err) {
      say(`${betterCopy.voteFailed} ${reasonOf(err)}`, 6000)
    } finally {
      setPending(id, false)
    }
    await refresh()
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
  async function voteInstead(id: string): Promise<void> {
    const idea = ideas.find((i) => i.id === id)
    try {
      if (!idea || (idea.myVote !== 1 && !idea.own)) await voteOnIdea(id, 1)
    } catch (err) {
      say(`${betterCopy.voteFailed} ${reasonOf(err)}`, 6000)
    }
    await refresh()
    const after = ideas.find((i) => i.id === id)
    if (!after) return
    selectTab(after.status)
    flash(id)
  }

  // ——— share: the judge first, then the idea (with your +1) and the makers' inbox ———
  async function check(text: string): Promise<BoardCheckResult | null> {
    busy = true
    try {
      return await checkIdea(text)
    } catch (err) {
      const reason = err instanceof BoardRequestError ? err.message : reasonOf(err)
      say(`${betterCopy.shareFailed} ${reason}`, 0)
      return null
    } finally {
      busy = false
    }
  }

  async function create(draft: {
    title: string
    kind: BoardKind
    area: BoardArea
  }): Promise<boolean> {
    busy = true
    try {
      const result = await shareIdea(draft)
      await refresh()
      selectTab('requested')
      flash(result.idea.id)
      if (result.inbox === 'failed') {
        say(`${betterCopy.sharedInboxFailed} ${result.inboxError ?? ''}`.trim(), 0)
      } else {
        say(betterCopy.sharedThanks, 4600)
      }
      return true
    } catch (err) {
      say(`${betterCopy.shareFailed} ${reasonOf(err)}`, 0)
      return false
    } finally {
      busy = false
    }
  }

  // ——— your own Requested rows: correct the reading, or forget it ———
  async function correct(id: string, patch: { kind?: BoardKind; area?: BoardArea }): Promise<void> {
    if (pendingIds.has(id)) return
    setPending(id, true)
    try {
      await correctIdea(id, patch)
    } catch (err) {
      say(reasonOf(err), 6000)
    } finally {
      setPending(id, false)
    }
    await refresh()
  }

  async function forget(id: string): Promise<void> {
    if (pendingIds.has(id)) return
    setPending(id, true)
    let gone = false
    try {
      await forgetIdea(id)
      gone = true
    } catch (err) {
      say(reasonOf(err), 6000)
    } finally {
      setPending(id, false)
    }
    await refresh()
    if (gone) say(betterCopy.forgotten, 2400)
  }

  onMount(() => {
    // the dot clears once you've looked
    clearFeedbackNote()
    void refresh()

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

<!-- what this page is, then the tabs: fixed under the header and outside the page mask -->
<div
  use:portal
  use:publishHeadHeight
  class="fixed left-1/2 -translate-x-1/2 top-[calc(var(--head,68px)+12px)] z-30 flex flex-col items-start gap-4 w-[min(636px,calc(100vw-44px))] animate-[fade_0.7s_var(--ease)_0.1s_both]"
>
  <!-- Eigenmesh is shaped by the people who use it -->
  <p class="m-0 text-sm leading-[1.55] text-ink-2">{m.better_intro()}</p>

  <!-- the same shadcn tabs as Settings, then search at the row's end -->
  <div class="flex items-center gap-2 max-w-full">
    <Tabs.Root
      value={tab}
      onValueChange={(v) => selectTab(v as BoardTab)}
      class={search.open ? 'max-[640px]:hidden' : ''}
    >
      <Tabs.List>
        {#each BOARD_TABS as t (t)}
          <!-- smaller than Settings: every board tab fits on one phone-width line -->
          <Tabs.Trigger value={t} class="px-2.5 text-xs max-[400px]:px-2">
            {statusLabel(t)}
            <span class="ml-[3px] text-ink-3 [font-variant-numeric:tabular-nums]">{counts[t]}</span>
          </Tabs.Trigger>
        {/each}
      </Tabs.List>
    </Tabs.Root>

    <div
      class={[
        'relative flex h-9 items-center rounded-full bg-paper-2',
        search.open ? 'pr-0.5 max-[640px]:w-[calc(100vw-44px)]' : '',
      ]}
    >
      <button
        class="grid size-9 place-items-center border-0 rounded-full bg-transparent text-ink-2 transition-colors duration-300 ease-settle pointer-fine:hover:text-ink"
        class:pointer-events-none={search.open}
        type="button"
        aria-label={m.yarn_search()}
        onclick={openSearch}
      >
        <svg
          class="size-3.5 fill-none stroke-current [stroke-width:1.4] [stroke-linecap:round]"
          viewBox="0 0 16 16"
          aria-hidden="true"
        >
          <circle cx="7" cy="7" r="4.2" />
          <path d="m10.2 10.2 3.3 3.3" />
        </svg>
      </button>
      <input
        bind:this={searchEl}
        bind:value={search.query}
        class={[
          'w-0 p-0 border-0 bg-transparent text-sm text-ink caret-signal outline-none opacity-0 placeholder:text-ink-3 [transition:width_0.5s_var(--ease),opacity_0.3s_var(--ease)] [&::-webkit-search-cancel-button]:hidden',
          search.open ? 'w-[170px] opacity-100 max-[640px]:flex-1 max-[640px]:w-auto' : '',
        ]}
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
      <button
        class={[
          'w-[30px] h-9 place-items-center border-0 bg-transparent text-ink-3 pointer-fine:hover:text-ink',
          search.open ? 'grid' : 'hidden',
        ]}
        type="button"
        aria-label={m.graph_close()}
        onclick={closeSearch}
      >
        <svg
          class="size-3 fill-none stroke-current [stroke-width:1.4] [stroke-linecap:round]"
          viewBox="0 0 16 16"
          aria-hidden="true"
        >
          <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
        </svg>
      </button>
    </div>
  </div>
</div>

<div
  class="mx-auto max-w-[700px] pt-[calc(var(--head,68px)+12px+var(--board-head-height)+28px)] px-8 pb-[calc(var(--bottom-nav)+var(--glass-writer-height,64px)+48px)] max-[640px]:px-[22px]"
>
  <!-- the app's note (the clay dot's message): inline, dismissible; confirmations land here too -->
  <div
    class={[
      "items-start gap-2.5 mb-[22px] before:shrink-0 before:content-[''] before:size-1.5 before:mt-[7px] before:rounded-full before:bg-clay",
      note ? 'flex animate-[fade_0.5s_var(--ease)_both]' : 'hidden',
    ]}
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
        <svg
          class="size-3 fill-none stroke-current [stroke-width:1.4] [stroke-linecap:round]"
          viewBox="0 0 16 16"
          aria-hidden="true"
        >
          <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
        </svg>
      </button>
    {/if}
  </div>

  <!-- the board: one smooth crossfade of the whole list on tab change -->
  <div
    class="transition-opacity duration-300 ease-settle [&_*]:[animation:none_!important]"
    class:opacity-0={swapping}
    class:duration-[160ms]={swapping}
    aria-busy={!loaded}
  >
    {#each visibleRows as idea, i (idea.id)}
      <BoardRow
        {idea}
        index={i}
        mostWanted={idea.id === mostWanted}
        flash={idea.id === flashId}
        pending={pendingIds.has(idea.id)}
        onvote={(id, dir, button) => void vote(id, dir, button)}
        oncorrect={(id, patch) => void correct(id, patch)}
        onforget={(id) => void forget(id)}
      />
    {/each}
    {#if noMatches}
      <p class="mt-7 mb-0 text-sm text-ink-3">{m.yarn_no_matches()}</p>
    {/if}
  </div>
</div>

<!-- the shared writer docks itself (portaled outside the page mask so it never fades) -->
<ShareComposer
  bind:this={composer}
  maxLength={FEEDBACK_MAX_LENGTH}
  language={data.preferredLanguage}
  {busy}
  oncheck={check}
  oncreate={create}
  onvoteinstead={(id) => void voteInstead(id)}
/>
