<script lang="ts">
  import type { CreateProjectResponse } from '../../api/timeline/projects/+server'
  import type { PageData } from './$types'
  import { tick } from 'svelte'
  import { invalidate } from '$app/navigation'
  import { base, resolve } from '$app/paths'
  import { normalizeQuery, rowMatchesQuery } from '$lib/mesh/filter-matcher'
  import { meshSearch } from '$lib/mesh/mesh-search.svelte'
  import { m } from '$lib/paraglide/messages.js'
  import { getLocale } from '$lib/paraglide/runtime'
  import { pulseBrand } from '$lib/stores/brand-pulse.svelte'
  import { showWhisper } from '$lib/stores/whisper.svelte'
  import { agoLabel } from './thread-list'

  /**
   * Threads — what you're following (DESIGN.md "Mesh → Threads"; ei app.js
   * :1042-1063 projectListHTML, styles.css .projects/.proj-row). Each thread's
   * name is huge, in your voice; under it the one line we know about where it
   * stands, then its size in words. Loose ends close the list as a quiet row.
   * Rows are whole-row links to real routes, so back/forward work and the Mesh
   * layout's blur swap carries the tap-then-settle into the detail.
   */
  let { data }: { data: PageData } = $props()

  const nowMs = Date.now()

  const fmt = $derived({ nowMs, locale: getLocale(), timeZone: data.preferredTimezone })

  const dateFmt = $derived(
    new Intl.DateTimeFormat(fmt.locale, {
      timeZone: fmt.timeZone,
      day: 'numeric',
      month: 'short',
    }),
  )

  type Thread = PageData['threads'][number]

  /** ei app.js:1046 — "{n} thoughts · last added {ago}", or "Nothing in it yet". */
  function metaOf(thread: Thread): string {
    const parts: string[] = []
    if (thread.thoughtCount === 0) {
      parts.push(m.graph_timeline_project_empty_tasks())
    } else {
      parts.push(`${thread.thoughtCount} ${m.threads_thoughts()}`)
      if (thread.lastAddedIso) parts.push(agoLabel(thread.lastAddedIso, fmt))
    }
    if (thread.targetDate) {
      parts.push(m.graph_timeline_project_deadline({ date: dateFmt.format(new Date(thread.targetDate)) }))
    }
    if (thread.status === 'someday') parts.push(m.graph_timeline_project_status_someday())
    return parts.join(' · ')
  }

  /** The one line of "where it stands" the catalog knows: the next action, in your words. */
  function summaryOf(thread: Thread): string | null {
    if (thread.nextActionSummary) return thread.nextActionSummary
    if (thread.openTaskCount > 0) return m.graph_timeline_project_no_next_action()
    return null
  }

  /* search filters the list in place (ei app.js:1883) */
  const visibleThreads = $derived(
    data.threads.filter((thread) =>
      rowMatchesQuery([thread.label, summaryOf(thread) ?? ''].join('\n'), meshSearch.query),
    ),
  )
  const looseVisible = $derived(
    data.loose.thoughtCount > 0 && rowMatchesQuery(m.threads_loose_ends(), meshSearch.query),
  )
  const noMatches = $derived(
    normalizeQuery(meshSearch.query) !== '' && visibleThreads.length === 0 && !looseVisible,
  )

  /* ————— + New thread: name it inline, ↵ makes it, esc lets it go (ei app.js:1098-1116) ————— */
  let naming = $state(false)
  let newName = $state('')
  let creating = $state(false)
  let createError = $state<string | null>(null)
  /** The thread made this visit — it rises in on its own while the others hold still. */
  let freshId = $state<string | null>(null)
  let nameInput = $state<HTMLInputElement | null>(null)

  async function startNaming(): Promise<void> {
    naming = true
    newName = ''
    createError = null
    await tick()
    nameInput?.focus()
  }

  function letItGo(): void {
    naming = false
    newName = ''
  }

  /** ei app.js:1115 — leaving the empty field lets it go. */
  function onNameBlur(): void {
    if (!creating && !newName.trim()) letItGo()
  }

  async function makeIt(): Promise<void> {
    const label = newName.trim()
    if (!label || creating) return
    creating = true
    createError = null
    try {
      // the same create endpoint /memory/projects and Patterns use
      const res = await fetch(`${base}/api/timeline/projects`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label, status: 'active' }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `Request failed (${res.status})`)
      }
      const body = (await res.json()) as CreateProjectResponse
      freshId = body.entityId
      naming = false
      newName = ''
      // explicit refetch after the mutation — the shared prefetch depends on this key
      await invalidate('timeline:temporal-events')
      pulseBrand(700)
      showWhisper([
        { text: m.whisper_knitting(), durationMs: 900 },
        { text: m.whisper_kept(), durationMs: 1600 },
      ])
    } catch (err) {
      createError = err instanceof Error ? err.message : String(err)
    } finally {
      creating = false
    }
  }

  function onNameKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      void makeIt()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      letItGo()
    }
  }
</script>

<div
  class="mx-auto max-w-[760px] pt-6 px-8 pb-[calc(var(--bottom-nav,calc(62px+env(safe-area-inset-bottom,0px)))+160px)] max-[640px]:px-[22px] font-mesh text-ink"
  aria-label={m.mesh_tabs_threads()}
>
  {#each visibleThreads as thread, i (thread.entityId)}
    {@const summary = summaryOf(thread)}
    <a
      class="block border-b border-line py-[30px] pb-7 text-inherit no-underline animate-[rise_0.8s_var(--ease)_both] [animation-delay:calc(var(--i,0)*70ms)] focus-visible:outline-none focus-visible:[&_h3]:underline focus-visible:[&_h3]:decoration-signal focus-visible:[&_h3]:decoration-1 focus-visible:[&_h3]:[text-underline-offset:6px] pointer-fine:hover:[&_h3]:translate-x-1"
      class:animate-none={freshId !== null && thread.entityId !== freshId}
      href={resolve('/mesh/threads/[id]', { id: thread.entityId })}
      data-testid={'thread-' + thread.entityId}
      style:--i={i}
    >
      <div class="flex items-center justify-between gap-6">
        <!-- the name is yours: Geist Mono, huge -->
        <h3
          class={["m-0 font-you font-normal text-[46px] leading-none tracking-[-0.02em] [overflow-wrap:anywhere] transition-transform duration-700 ease-settle max-[640px]:text-[36px]", freshId === thread.entityId && 'animate-[rise_1s_var(--ease)_both]']}
        >{thread.label}</h3>
      </div>
      {#if summary}
        <p class="mt-3.5 max-w-[560px] text-base leading-[1.55] text-ink-2">{summary}</p>
      {/if}
      <div class="mt-3 text-sm text-ink-3">{metaOf(thread)}</div>
    </a>
  {/each}

  {#if !normalizeQuery(meshSearch.query)}
    <div class="py-[26px] border-b border-line">
      {#if naming}
        <input
          class="block w-full border-0 bg-transparent font-you text-[46px] leading-[1.05] tracking-[-0.02em] text-ink caret-signal outline-none placeholder:text-ink-3 disabled:text-ink-3 max-[640px]:text-[36px]"
          type="text"
          bind:this={nameInput}
          bind:value={newName}
          maxlength="40"
          placeholder={m.capture_reading_new_thread()}
          aria-label={m.capture_reading_new_thread()}
          autocomplete="off"
          spellcheck="false"
          disabled={creating}
          onkeydown={onNameKeydown}
          onblur={onNameBlur}
        />
        <div class="mt-2.5 text-sm text-ink-3 hover-none:hidden" aria-hidden="true">↵ · esc</div>
      {:else}
        <button
          class="p-0 border-0 bg-transparent [font:inherit] text-sm text-ink-3 transition-colors duration-300 cursor-pointer pointer-fine:hover:text-ink"
          type="button"
          onclick={() => void startNaming()}
        >
          + {m.capture_reading_new_thread()}
        </button>
      {/if}
      {#if createError}
        <p class="mt-3 text-sm leading-[1.5] text-ink-3" role="alert">{createError}</p>
      {/if}
    </div>
  {/if}

  {#if looseVisible}
    <!-- Loose ends stay visible without nagging: a quiet row in the mesh's voice -->
    <a
      class="block border-b border-line py-[30px] pb-7 text-inherit no-underline animate-[rise_0.8s_var(--ease)_both] [animation-delay:calc(var(--i,0)*70ms)] focus-visible:outline-none focus-visible:[&_h3]:underline focus-visible:[&_h3]:decoration-signal focus-visible:[&_h3]:decoration-1 focus-visible:[&_h3]:[text-underline-offset:6px] pointer-fine:hover:[&_h3]:text-ink"
      href={resolve('/mesh/threads/loose')}
      data-testid="thread-loose"
      style:--i={visibleThreads.length + 1}
    >
      <div class="flex items-center justify-between gap-6">
        <h3 class="m-0 font-mesh text-[20px] font-normal leading-none tracking-[-0.02em] text-ink-2 [overflow-wrap:anywhere]">{m.threads_loose_ends()}</h3>
      </div>
      <p class="mt-3.5 max-w-[560px] text-base leading-[1.55] text-ink-2">
        {data.loose.thoughtCount}
        {m.threads_thoughts()}
        {#if data.loose.lastAddedIso}· {agoLabel(data.loose.lastAddedIso, fmt)}{/if}
      </p>
    </a>
  {/if}

  {#if noMatches}
    <p class="mt-[46px] text-sm text-ink-3" aria-live="polite">{m.yarn_no_matches()}</p>
  {/if}
</div>

