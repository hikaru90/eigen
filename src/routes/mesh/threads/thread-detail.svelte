<script lang="ts">
  import type { ThoughtKindOption } from '$lib/thought/kind-option'
  import { base, resolve } from '$app/paths'
  import { thoughtHref } from '$lib/chat/thought-href'
  import ThoughtInlineEditor from '$lib/components/mesh/thought-inline-editor.svelte'
  import ThoughtRow from '$lib/components/mesh/thought-row.svelte'
  import { relativeDayLabel } from '$lib/chat/relative-day'
  import { isTodoCategory } from '$lib/mesh/thought-status'
  import { m } from '$lib/paraglide/messages.js'
  import { getLocale } from '$lib/paraglide/runtime'
  import { showWhisper } from '$lib/stores/whisper.svelte'
  import {
    askWhereItStandsHref,
    captureIntoHref,
    datedLabel,
    type ThreadStanding,
    type ThreadThought,
  } from './thread-list'

  /**
   * One thread, up close (ei app.js:1065-1076 projectDetailHTML; styles.css
   * .pd-*): "← Threads", the name in your voice, where it stands, open
   * questions, two actions, then its thoughts as dated rows. The same page
   * shows Loose ends (title in the mesh's voice, no standing, no actions).
   * Rows never open on tap — the chevron unfolds a thought in place, in the flow
   * of the page; nothing here leads to another page or a modal. The unfolded row is
   * where the thought is changed — words, type, thread (board b6f74d02); a thought
   * moved to another thread leaves this list.
   */
  type Props = {
    title: string
    /** The GTD project's entity id; null for Loose ends. */
    entityId: string | null
    standing: ThreadStanding | null
    questions: ThreadThought[]
    thoughts: ThreadThought[]
    preferredTimezone: string
    /** The type menu in an unfolded row: the active thought kinds. */
    kinds: ThoughtKindOption[]
  }

  let { title, entityId, standing, questions, thoughts, preferredTimezone, kinds }: Props = $props()

  const nowMs = Date.now()
  const fmt = $derived({ nowMs, locale: getLocale(), timeZone: preferredTimezone })
  const dateFmt = $derived(
    new Intl.DateTimeFormat(fmt.locale, { timeZone: fmt.timeZone, day: 'numeric', month: 'short' }),
  )

  /** Tick overrides applied after a successful PATCH, keyed by thought id (as Yarn does). */
  let tickStatus = $state<Record<string, 'open' | 'completed'>>({})
  let tickBusyId = $state<string | null>(null)

  /** Words and type the server kept after an edit in an unfolded row, keyed by thought id. */
  let edited = $state<Record<string, { text: string; category: string }>>({})
  /** Thoughts moved off this list (to another thread, or onto one from Loose ends). */
  let movedAway = $state<Record<string, true>>({})
  /** This list's own thread, as an unfolded row's thread pill shows it. */
  const ownThread = $derived(entityId ? { entityId, label: title } : null)

  const rows = $derived(
    thoughts
      .filter((row) => !movedAway[row.thoughtId])
      .map((row) => {
        const status = tickStatus[row.thoughtId] ?? row.status
        return { ...row, ...edited[row.thoughtId], status }
      }),
  )

  function applyRowChange(
    thoughtId: string,
    next: { text: string; category: string; thread: { entityId: string; label: string } | null },
  ): void {
    if ((next.thread?.entityId ?? null) !== (ownThread?.entityId ?? null)) {
      movedAway = { ...movedAway, [thoughtId]: true }
      showWhisper([
        { text: next.thread ? next.thread.label : m.capture_reading_loose(), durationMs: 1600 },
      ])
      return
    }
    edited = { ...edited, [thoughtId]: { text: next.text, category: next.category } }
  }

  /** The mesh's facts about where it stands, in words: open tasks · due · overdue · someday. */
  const facts = $derived.by<string[]>(() => {
    if (!standing) return []
    const out: string[] = []
    if (standing.openTaskCount > 0) {
      out.push(m.graph_timeline_project_open_loops({ count: standing.openTaskCount }))
    } else if (!standing.targetDate && standing.milestones.length === 0) {
      out.push(m.graph_timeline_project_empty_tasks())
    }
    if (standing.targetDate) {
      out.push(
        m.graph_timeline_project_deadline({ date: dateFmt.format(new Date(standing.targetDate)) }),
      )
    }
    if (
      standing.stalledReason === 'deadline_overdue' ||
      standing.stalledReason === 'milestone_overdue'
    ) {
      out.push(m.graph_timeline_pill_overdue())
    }
    if (standing.status === 'someday') out.push(m.graph_timeline_project_status_someday())
    return out
  })

  const askQuestion = $derived(`${m.threads_where_it_stands()} — ${title}`)

  function relatedItem(r: { id: string; text: string; createdAtIso: string }) {
    return {
      id: r.id,
      text: r.text,
      dateLabel: relativeDayLabel(r.createdAtIso, new Date(nowMs), getLocale()),
      href: thoughtHref(r.id),
    }
  }

  async function toggleDone(row: ThreadThought): Promise<void> {
    if (tickBusyId) return
    const next = row.status === 'completed' ? 'open' : 'completed'
    tickBusyId = row.thoughtId
    try {
      // the thought's real lifecycle endpoint, as the Yarn tick uses it
      const res = await fetch(`${base}/api/thoughts/${encodeURIComponent(row.thoughtId)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      if (!res.ok) {
        throw new Error(`thread tick failed: ${res.status} ${await res.text()}`)
      }
      // success only — the row never lies about its state
      tickStatus = { ...tickStatus, [row.thoughtId]: next }
      if (next === 'completed') {
        showWhisper([{ text: m.whisper_done(), durationMs: 1200 }])
      }
    } catch (error) {
      // no fallbacks: the row stays unticked and the failure is loud
      console.error('[threads] tick failed', error)
    } finally {
      tickBusyId = null
    }
  }
</script>

<div
  class="mx-auto max-w-[760px] pt-6 px-8 pb-[calc(var(--bottom-nav,calc(62px+env(safe-area-inset-bottom,0px)))+160px)] max-[640px]:px-[22px] font-mesh text-ink"
>
  <a
    class="inline-flex items-center gap-2 py-1 text-sm text-ink-3 no-underline transition-colors duration-300 animate-[fade_0.6s_var(--ease)_both] pointer-fine:hover:text-ink"
    href={resolve('/mesh/threads')}>← {m.mesh_tabs_threads()}</a
  >

  <!-- the name: yours (Geist Mono); Loose ends is the mesh's (Inter) -->
  <h2
    class={[
      'mt-[30px] font-normal leading-[0.95] [overflow-wrap:anywhere] animate-[rise_0.9s_var(--ease)_both_0.05s] text-[clamp(44px,8vw,92px)] max-[640px]:text-[clamp(44px,8vw,92px)]',
      entityId === null
        ? 'font-mesh text-[40px] max-[640px]:text-[32px] tracking-[-0.035em]'
        : 'font-you tracking-[-0.028em]',
    ]}
  >
    {title}
  </h2>
  <div class="mt-[18px] text-sm text-ink-3 animate-[fade_0.8s_var(--ease)_both_0.15s]">
    {thoughts.length}
    {m.threads_thoughts()}
  </div>

  {#if entityId !== null}
    <!-- secondary actions: outline pills; the thread's name stays in your voice -->
    <div class="flex flex-wrap gap-2.5 mt-[26px] animate-[fade_0.8s_var(--ease)_both_0.2s]">
      <a
        class="inline-flex items-center gap-1.5 min-h-9 px-4 py-1.5 rounded-[18px] text-sm text-ink-2 no-underline [transition:color_0.3s,box-shadow_0.4s_var(--ease)] shadow-[inset_0_0_0_1px_var(--ink-4)] pointer-fine:hover:text-ink pointer-fine:hover:shadow-[inset_0_0_0_1px_var(--ink-3)]"
        href={captureIntoHref(base, entityId)}
      >
        {m.nav_capture()} →
        <span class="font-you text-[1.15em] tracking-normal text-ink">{title}</span>
      </a>
      <a
        class="inline-flex items-center gap-1.5 min-h-9 px-4 py-1.5 rounded-[18px] text-sm text-ink-2 no-underline [transition:color_0.3s,box-shadow_0.4s_var(--ease)] shadow-[inset_0_0_0_1px_var(--ink-4)] pointer-fine:hover:text-ink pointer-fine:hover:shadow-[inset_0_0_0_1px_var(--ink-3)]"
        href={askWhereItStandsHref(base, askQuestion)}
      >
        {m.threads_where_it_stands()}?
      </a>
    </div>
  {/if}

  {#if standing}
    <section class="mt-[52px] animate-[rise_0.8s_var(--ease)_both_0.25s]">
      <div class="mb-3 text-sm text-ink-3">{m.threads_where_it_stands()}</div>
      {#if standing.nextActionSummary}
        <div class="text-sm text-ink-3">{m.graph_timeline_project_next_action()}</div>
        <p
          class="max-w-[600px] mt-1.5 mb-0 font-you text-[21px] leading-[1.3] tracking-[-0.006em] text-pretty"
        >
          {standing.nextActionSummary}
        </p>
      {:else if standing.openTaskCount > 0}
        <p class="max-w-[600px] m-0 text-[19px] leading-[1.5] tracking-[-0.014em]">
          {m.graph_timeline_project_no_next_action()}
        </p>
      {/if}
      {#if facts.length > 0}
        <p class="mt-3.5 mb-0 text-sm leading-[1.5] text-ink-2">{facts.join(' · ')}</p>
      {/if}
      {#if standing.milestones.length > 0}
        <ul class="mt-[18px] list-none m-0 p-0">
          {#each standing.milestones as milestone (milestone.id)}
            <li
              class="flex items-start gap-3.5 py-3 border-t border-line text-base leading-[1.5] text-ink-2 before:shrink-0 before:size-1.5 before:mt-2 before:rounded-full before:shadow-[inset_0_0_0_1px_var(--ink-3)] before:content-['']"
              class:text-ink-3={milestone.completedAt !== null}
              class:before:bg-ink-2={milestone.completedAt !== null}
              class:before:shadow-none={milestone.completedAt !== null}
            >
              <span
                class="flex-1 min-w-0"
                class:line-through={milestone.completedAt !== null}
                class:decoration-ink-4={milestone.completedAt !== null}>{milestone.label}</span
              >
              {#if milestone.targetDate}
                <span class="shrink-0 text-sm text-ink-3 [font-variant-numeric:tabular-nums]"
                  >{dateFmt.format(new Date(milestone.targetDate))}</span
                >
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}

  {#if questions.length > 0}
    <section class="mt-[52px] animate-[rise_0.8s_var(--ease)_both_0.25s]">
      <div class="mb-3 text-sm text-ink-3">{m.threads_open_questions()}</div>
      <ul class="list-none m-0 p-0">
        {#each questions as question (question.thoughtId)}
          <li
            class="flex items-start gap-3.5 py-3 border-t border-line text-base leading-[1.5] text-ink-2 before:shrink-0 before:size-1.5 before:mt-2 before:rounded-full before:shadow-[inset_0_0_0_1px_var(--ink-3)] before:content-['']"
          >
            <span class="flex-1 min-w-0 font-you text-[17px] leading-[1.35] text-ink"
              >{question.text}</span
            >
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section class="mt-[52px] animate-[rise_0.8s_var(--ease)_both_0.25s]">
    <div class="mb-3 text-sm text-ink-3">{m.threads_thoughts()}</div>
    {#if rows.length === 0}
      <p class="m-0 text-base text-ink-3">{m.graph_timeline_project_empty_tasks()}</p>
    {:else}
      {#each rows as row, i (row.thoughtId)}
        <ThoughtRow
          thoughtId={row.thoughtId}
          text={row.text}
          timeLabel={datedLabel(row.createdAt, fmt)}
          index={i}
          done={row.status === 'completed'}
          showTick={isTodoCategory(row.category)}
          tickLabel={row.status === 'completed'
            ? m.graph_temporal_reopen()
            : m.graph_temporal_mark_done()}
          relatedLabel={m.thought_open_page()}
          related={row.related.map((r) => relatedItem(r))}
          ontoggle={() => void toggleDone(row)}
        >
          {#snippet editor()}
            <ThoughtInlineEditor
              thoughtId={row.thoughtId}
              text={row.text}
              category={row.category}
              thread={ownThread}
              {kinds}
              onchange={(next) => applyRowChange(row.thoughtId, next)}
            />
          {/snippet}
        </ThoughtRow>
      {/each}
    {/if}
  </section>
</div>
