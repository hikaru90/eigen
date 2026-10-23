import type { ResolvedPathname } from '$app/types'
import { capitalizeFirst, dayNumberInZone, timeOfDayLabel } from '$lib/mesh/day-groups'

/**
 * Threads — the pure parts of the projects list and detail (ei redesign, wave
 * 3.2). A port of ei app.js:1042-1076 (`projectListHTML` / `projectDetailHTML`)
 * and the `ago()` / `shortDay()` helpers at app.js:53-66, written over the
 * unified-timeline items that `/memory/projects` already loads
 * (TemporalEventListItem, src/lib/server/memory/temporal-event-list.ts:47-82).
 *
 * Grouping and formatting only. Which hub is a GTD project was decided
 * upstream (project_status set — listProjects, project-list.ts:243-249), and
 * which thought is a question was decided by the LLM at capture (its persisted
 * category key). Nothing here decides meaning. Labels come from Intl in the
 * UI locale — no hardcoded copy in either language.
 */

/** The minimum a timeline item needs to be grouped and counted here. */
export type ThreadItemLike = {
  thoughtId: string
  projectEntityId: string | null
  /** ISO instant the thought was captured. */
  createdAt: string
}

export type ThreadQuestionLike = ThreadItemLike & {
  thoughtCategory: string
  thoughtStatus: 'open' | 'completed' | 'archived'
}

export type ThreadGroups<T extends ThreadItemLike> = {
  /** Items per thread (project entity id), in input order. */
  byThread: Map<string, T[]>
  /** Loose ends: items whose thought is not on any thread. */
  loose: T[]
}

export type ThreadMeta = {
  /** Thoughts, not items — one thought with three dated events is one thought. */
  thoughtCount: number
  lastAddedIso: string | null
}

export type ThreadFormatOptions = {
  nowMs: number
  locale: string
  timeZone: string
}

/* ———— the detail's page-data shapes (shared by [id] and loose, and the detail component) ———— */

/** One thought on a thread, as the detail renders it (the unified timeline's row, folded). */
export type ThreadThought = {
  thoughtId: string
  text: string
  createdAt: string
  category: string
  status: 'open' | 'completed' | 'archived'
}

export type ThreadMilestone = {
  id: string
  label: string
  targetDate: string | null
  completedAt: string | null
}

/** Where it stands — the catalog's facts about a GTD project (project-list.ts ProjectListItem). */
export type ThreadStanding = {
  status: 'active' | 'someday' | 'completed' | 'dismissed'
  nextActionSummary: string | null
  openTaskCount: number
  targetDate: string | null
  stalledReason: 'deadline_overdue' | 'milestone_overdue' | 'no_next_action' | null
  milestones: ThreadMilestone[]
}

/** The unified timeline's row (TemporalEventListItem) as the detail renders it. */
export function toThreadThought(item: {
  thoughtId: string
  thoughtText: string
  createdAt: string
  thoughtCategory: string
  thoughtStatus: 'open' | 'completed' | 'archived'
}): ThreadThought {
  return {
    thoughtId: item.thoughtId,
    text: item.thoughtText,
    createdAt: item.createdAt,
    category: item.thoughtCategory,
    status: item.thoughtStatus,
  }
}

/**
 * The ontology key of a question thought (seed-default-cognitive.ts:43). The
 * same rendering-only use of an LLM-decided category key as `isTodoCategory`
 * (src/lib/mesh/thought-status.ts:33-35).
 */
export const QUESTION_CATEGORY = 'question'

/** ei app.js:41,1053 — a thread's items, and the loose ends beside them. */
export function groupItemsByThread<T extends ThreadItemLike>(items: readonly T[]): ThreadGroups<T> {
  const byThread = new Map<string, T[]>()
  const loose: T[] = []
  for (const item of items) {
    if (item.projectEntityId === null) {
      loose.push(item)
      continue
    }
    const bucket = byThread.get(item.projectEntityId)
    if (bucket) bucket.push(item)
    else byThread.set(item.projectEntityId, [item])
  }
  return { byThread, loose }
}

/**
 * One row per thought, newest first. The timeline lists a thought once per
 * task/event it carries; a thread shows the thought itself. The first item seen
 * for a thought is kept, so a stable input order is a stable tie-break.
 */
export function uniqueThoughts<T extends ThreadItemLike>(items: readonly T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    if (seen.has(item.thoughtId)) continue
    seen.add(item.thoughtId)
    out.push(item)
  }
  return out.sort((a, b) => parseInstant(b.createdAt) - parseInstant(a.createdAt))
}

/** ei app.js:1046 — "{n} thoughts · last added {ago}", as data. */
export function threadMeta(items: readonly ThreadItemLike[]): ThreadMeta {
  const rows = uniqueThoughts(items)
  return {
    thoughtCount: rows.length,
    lastAddedIso: rows[0]?.createdAt ?? null,
  }
}

/** ei app.js:1074 — the thread's open questions: open thoughts of the question kind. */
export function openQuestionsOf<T extends ThreadQuestionLike>(items: readonly T[]): T[] {
  return uniqueThoughts(
    items.filter(
      (item) => item.thoughtCategory === QUESTION_CATEGORY && item.thoughtStatus === 'open',
    ),
  )
}

/**
 * ei app.js:53-60 `ago()` — today, yesterday, then days (< 14), weeks (< 60
 * days), months. Day boundaries are local midnights in the user's timezone so
 * SSR and client agree; words come from Intl.RelativeTimeFormat.
 */
export function agoLabel(iso: string, opts: ThreadFormatOptions): string {
  const diff = dayDiff(iso, opts)
  if (diff <= 1) {
    return new Intl.RelativeTimeFormat(opts.locale, { numeric: 'auto' }).format(-Math.max(diff, 0), 'day')
  }
  const always = new Intl.RelativeTimeFormat(opts.locale, { numeric: 'always' })
  if (diff < 14) return always.format(-diff, 'day')
  if (diff < 60) return always.format(-Math.round(diff / 7), 'week')
  return always.format(-Math.round(diff / 30), 'month')
}

/**
 * ei app.js:61-66 `shortDay()` — the dated row's time column: the clock for
 * today, "Yesterday" as a word, otherwise day and short month from Intl.
 */
export function datedLabel(iso: string, opts: ThreadFormatOptions): string {
  const diff = dayDiff(iso, opts)
  if (diff <= 0) return timeOfDayLabel(iso, { locale: opts.locale, timeZone: opts.timeZone })
  if (diff === 1) {
    return capitalizeFirst(
      new Intl.RelativeTimeFormat(opts.locale, { numeric: 'auto' }).format(-1, 'day'),
    )
  }
  return new Intl.DateTimeFormat(opts.locale, {
    timeZone: opts.timeZone,
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso))
}

/**
 * ei app.js:1086 — "Capture into <thread>": the capture page with the thread
 * preset by entity id. Coordination is by URL only; `/capture` reads `thread`.
 * Typed as `ResolvedPathname` (assembled from `base`, like
 * src/lib/chat/thought-href.ts) so anchors satisfy
 * `svelte/no-navigation-without-resolve`.
 */
export function captureIntoHref(base: string, projectEntityId: string): ResolvedPathname {
  return `${base}/capture?thread=${encodeURIComponent(projectEntityId)}` as ResolvedPathname
}

/**
 * ei app.js:1087 — "Where does it stand?": Ask with the question in the query.
 * Coordination is by URL only; `/chat` reads `q`.
 */
export function askWhereItStandsHref(base: string, question: string): ResolvedPathname {
  return `${base}/chat?q=${encodeURIComponent(question)}` as ResolvedPathname
}

function parseInstant(iso: string): number {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) {
    throw new Error(`thread-list: invalid ISO date: ${iso}`)
  }
  return ms
}

/** Whole local days between the instant and now, in the user's timezone. */
function dayDiff(iso: string, opts: ThreadFormatOptions): number {
  parseInstant(iso)
  return (
    dayNumberInZone(new Date(opts.nowMs).toISOString(), opts.timeZone) -
    dayNumberInZone(iso, opts.timeZone)
  )
}
