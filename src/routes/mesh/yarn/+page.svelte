<script lang="ts">
  import type { PageData } from './$types'
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { base, resolve } from '$app/paths'
  import ThoughtRow from '$lib/components/mesh/thought-row.svelte'
  import { hapticConfirm } from '$lib/haptics'
  import {
    groupThoughtsByDay,
    isFreshThought,
    timeOfDayLabel,
    type DayGroupOptions,
  } from '$lib/mesh/day-groups'
  import { normalizeQuery, rowMatchesQuery } from '$lib/mesh/filter-matcher'
  import { meshSearch } from '$lib/mesh/mesh-search.svelte'
  import { meshApiUrlForView } from '$lib/mesh/mesh-view-fetch'
  import { m } from '$lib/paraglide/messages.js'
  import { getLocale } from '$lib/paraglide/runtime'
  import { subscribeCurrentUserView, type CurrentUserView } from '$lib/stores/current-user-view.svelte'
  import { showWhisper } from '$lib/stores/whisper.svelte'
  import { shouldRefetchForViewChange } from '../../timeline/timeline-client-loads'

  /**
   * Yarn — every thought on one continuous strand, grouped by day (DESIGN.md
   * "Mesh → Yarn"). ei styles.css .stream/.day/.thought; rows are the shared
   * thought-row component. Rows never open on tap; the open control leads to
   * the thought page (wave 3). Ticking a to-do PATCHes the thought's real
   * lifecycle endpoint (PATCH /api/thoughts/[thoughtId]).
   *
   * The strand follows the global data view (the header dropdown): SSR seeds
   * the default 'You' scope; the client refetches /api/mesh/yarn when the
   * stored view differs and on every later view change — the same contract
   * the unified timeline uses.
   */
  let { data }: { data: PageData } = $props()

  // Render-time instant for the fresh signal dot; set once per view, like ei.
  const nowMs = Date.now()

  const dayOpts = $derived.by<DayGroupOptions>(() => {
    const locale = getLocale()
    const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    return {
      locale,
      timeZone: data.preferredTimezone,
      nowMs,
      todayLabel: relative.format(0, 'day'),
      yesterdayLabel: relative.format(-1, 'day'),
    }
  })

  /** Tick overrides applied after a successful PATCH, keyed by thought id. */
  let tickStatus = $state<Record<string, 'open' | 'completed'>>({})
  let tickBusyId = $state<string | null>(null)

  /** Live rows — SSR seed first, then whatever /api/mesh/yarn returns per view.
   *  Capturing the seed once per mount is intentional (the timeline shell does
   *  the same); view refetches replace it wholesale. */
  // svelte-ignore state_referenced_locally (one-time SSR seed, replaced on view change)
  let thoughtRows = $state(data.thoughts)

  async function refreshForView(view: CurrentUserView): Promise<void> {
    try {
      const res = await fetch(`${base}${meshApiUrlForView('yarn', view)}`, { credentials: 'include' })
      if (!res.ok) {
        throw new Error(`yarn load failed: ${res.status} ${await res.text()}`)
      }
      const body = (await res.json()) as { thoughts: typeof data.thoughts }
      thoughtRows = body.thoughts
    } catch (error) {
      // no fallbacks: keep the current strand, say the load failed out loud
      console.error('[yarn] view load failed', error)
      showWhisper([{ text: m.yarn_load_failed(), durationMs: 2400 }])
    }
  }

  onMount(() => {
    // The SSR seed is the default 'You' scope; the subscribe fires immediately
    // with the stored view, so a differing view refetches right away.
    let previousView: CurrentUserView = 'user'
    return subscribeCurrentUserView((view) => {
      if (!shouldRefetchForViewChange(previousView, view)) return
      previousView = view
      void refreshForView(view)
    })
  })

  /** Rows with tick overrides folded in, carrying their global stagger index. */
  const rows = $derived.by(() =>
    thoughtRows.map((row, index) => {
      const override = tickStatus[row.id]
      return override ? { ...row, status: override, index } : { ...row, index }
    }),
  )

  const groups = $derived.by(() => {
    const all = groupThoughtsByDay(rows, dayOpts)
    const query = meshSearch.query
    if (!normalizeQuery(query)) return all
    return all
      .map((group) => ({
        label: group.label,
        items: group.items.filter((row) => rowMatchesQuery(visibleTextOf(row), query)),
      }))
      .filter((group) => group.items.length > 0)
  })

  /** ei app.js:1871 — 'No matches' while the query filters everything away. */
  const noMatches = $derived(normalizeQuery(meshSearch.query) !== '' && groups.length === 0)
  const isEmpty = $derived(normalizeQuery(meshSearch.query) === '' && groups.length === 0)

  /** The row's visible words: text, kind chip and thread name (not the time). */
  function visibleTextOf(row: (typeof rows)[number]): string {
    const kind = data.kindLabels[row.category] ?? ''
    return [row.text, kind, row.threadLabel ?? ''].join('\n')
  }

  async function toggleDone(row: (typeof rows)[number]): Promise<void> {
    if (tickBusyId) return
    const next = row.status === 'completed' ? 'open' : 'completed'
    hapticConfirm() // in the tap, before the await
    tickBusyId = row.id
    try {
      const res = await fetch(`${base}/api/thoughts/${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      if (!res.ok) {
        throw new Error(`yarn tick failed: ${res.status} ${await res.text()}`)
      }
      // success only — the row never lies about its state
      tickStatus = { ...tickStatus, [row.id]: next }
      if (next === 'completed') {
        // ei app.js:771 — a to-do can simply be done; the whisper says so
        showWhisper([{ text: m.whisper_done(), durationMs: 1200 }])
      }
    } catch (error) {
      // no fallbacks: the row stays unticked and the failure is loud
      console.error('[yarn] tick failed', error)
    } finally {
      tickBusyId = null
    }
  }

  function openThought(row: (typeof rows)[number]): void {
    void goto(resolve('/thought/[id]', { id: encodeURIComponent(row.id) }))
  }
</script>

<!-- the strand: max-width column under the tabs, above the menu (ei styles.css .stream) -->
<div
  class="mx-auto max-w-[700px] pt-[22px] px-8 pb-[calc(var(--bottom-nav,calc(62px+env(safe-area-inset-bottom,0px)))+160px)] max-[640px]:px-[22px]"
>
  {#each groups as group (group.label)}
    <section class="mt-[46px] first:mt-[18px]">
      <!-- a running stitch, not a rule -->
      <header
        class="mb-1.5 flex items-baseline justify-between pb-3 text-sm text-ink-3 animate-[fade_0.8s_var(--ease)_both] [background:repeating-linear-gradient(90deg,var(--ink-4)_0_7px,transparent_7px_12px)_left_bottom/100%_1.2px_no-repeat]"
      >
        <b class="font-medium text-ink-2">{group.label}</b>
      </header>
      {#each group.items as row (row.id)}
        <ThoughtRow
          thoughtId={row.id}
          text={row.text}
          timeLabel={timeOfDayLabel(row.createdAtIso, {
            locale: dayOpts.locale,
            timeZone: dayOpts.timeZone,
          })}
          index={row.index}
          fresh={isFreshThought(row.createdAtIso, nowMs)}
          done={row.status === 'completed'}
          showTick={row.isTodo}
          tickLabel={row.status === 'completed' ? m.graph_temporal_reopen() : m.graph_temporal_mark_done()}
          openLabel={m.desk_action_open_task()}
          kindLabel={data.kindLabels[row.category] ?? null}
          threadLabel={row.threadLabel}
          ontoggle={() => void toggleDone(row)}
          onopen={() => openThought(row)}
        />
      {/each}
    </section>
  {/each}

  {#if isEmpty}
    <p class="mt-[46px] text-sm text-ink-3">{m.yarn_empty()}</p>
  {/if}

  {#if noMatches}
    <p class="mt-[46px] text-sm text-ink-3" aria-live="polite">{m.yarn_no_matches()}</p>
  {/if}
</div>

