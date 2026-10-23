/**
 * Input-summary builder for the Patterns judge (ei redesign wave 2.4).
 *
 * Pure module: turns raw window rows + community overlays + thread activity
 * into the structured summary the LLM judge reads. No meaning decisions here —
 * the judge (with the ontology catalog in its prompt) notices the patterns.
 */

/** The window the mesh looks back over ("last ~3 weeks"). */
export const PATTERNS_WINDOW_DAYS = 21
/** How many thought summaries ride in the prompt catalog at most. */
export const PATTERNS_CATALOG_LIMIT = 60
export const PATTERN_ROW_SUMMARY_MAX_LENGTH = 120
/** Thread activity lines carried into the prompt at most. */
export const PATTERNS_THREAD_ACTIVITY_LIMIT = 8

export type PatternThoughtRow = {
  id: string
  category: string
  createdAt: Date
  communityIds: readonly string[]
  /** Short decrypted summary of the thought; null rows never enter the catalog. */
  summary: string | null
}

export type PatternCommunityOverlay = {
  id: string
  name: string
}

export type PatternThreadActivityRow = {
  label: string
  recentThoughtCount: number
}

export type PatternsThoughtCatalogEntry = {
  id: string
  day: string
  category: string
  communities: string[]
  summary: string
}

export type PatternsLlmInput = {
  window: { days: number; startDate: string; endDate: string }
  totalThoughts: number
  thoughtsPerDay: { date: string; count: number }[]
  categoryMix: { category: string; count: number }[]
  communityActivity: { name: string; recentThoughtCount: number }[]
  threadActivity: { label: string; recentThoughtCount: number }[]
  thoughtCatalog: PatternsThoughtCatalogEntry[]
}

/** UTC calendar day of a timestamp — the grouping day for everything here. */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function utcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

/**
 * First instant of the window: UTC midnight `windowDays - 1` days before `today`'s
 * UTC day, so the window spans `windowDays` calendar days including today.
 * Shared by the SQL loader and the builder so both agree on what "the window" is.
 */
export function patternsWindowStart(today: Date, windowDays: number = PATTERNS_WINDOW_DAYS): Date {
  const start = utcMidnight(today)
  start.setUTCDate(start.getUTCDate() - (windowDays - 1))
  return start
}

function byCountDescThenKey<T>(keyOf: (item: T) => string, countOf: (item: T) => number) {
  return (a: T, b: T): number => {
    if (countOf(b) !== countOf(a)) return countOf(b) - countOf(a)
    return keyOf(a).localeCompare(keyOf(b))
  }
}

export function buildPatternsLlmInput(args: {
  rows: readonly PatternThoughtRow[]
  overlays: readonly PatternCommunityOverlay[]
  threadActivity: readonly PatternThreadActivityRow[]
  today: Date
  windowDays?: number
  catalogLimit?: number
}): PatternsLlmInput {
  const windowDays = args.windowDays ?? PATTERNS_WINDOW_DAYS
  const catalogLimit = args.catalogLimit ?? PATTERNS_CATALOG_LIMIT

  const endDate = utcMidnight(args.today)
  const startDate = patternsWindowStart(args.today, windowDays)

  const inWindow = args.rows.filter((row) => row.createdAt.getTime() >= startDate.getTime())

  const nameByCommunityId = new Map(
    args.overlays.map((overlay) => [overlay.id, overlay.name] as const),
  )

  const countsPerDay = new Map<string, number>()
  const countsPerCategory = new Map<string, number>()
  const countsPerCommunity = new Map<string, number>()
  const catalog: Array<PatternsThoughtCatalogEntry & { createdAt: Date }> = []

  for (const row of inWindow) {
    const day = isoDay(row.createdAt)
    countsPerDay.set(day, (countsPerDay.get(day) ?? 0) + 1)
    countsPerCategory.set(row.category, (countsPerCategory.get(row.category) ?? 0) + 1)

    const communityNames: string[] = []
    for (const communityId of row.communityIds) {
      const name = nameByCommunityId.get(communityId)
      if (name === undefined) continue
      if (!communityNames.includes(name)) communityNames.push(name)
      countsPerCommunity.set(name, (countsPerCommunity.get(name) ?? 0) + 1)
    }

    const summary = row.summary?.trim()
    if (summary) {
      catalog.push({
        id: row.id,
        day,
        category: row.category,
        communities: communityNames,
        summary: clampSummary(summary),
        createdAt: row.createdAt,
      })
    }
  }

  // Newest first — the catalog is "what the last weeks held", capped.
  const sortedCatalog: PatternsThoughtCatalogEntry[] = catalog
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, catalogLimit)
    .map(({ createdAt: _createdAt, ...entry }) => entry)

  return {
    window: { days: windowDays, startDate: isoDay(startDate), endDate: isoDay(endDate) },
    totalThoughts: inWindow.length,
    thoughtsPerDay: [...countsPerDay.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    categoryMix: [...countsPerCategory.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort(byCountDescThenKey((entry) => entry.category, (entry) => entry.count)),
    communityActivity: [...countsPerCommunity.entries()]
      .map(([name, recentThoughtCount]) => ({ name, recentThoughtCount }))
      .sort(byCountDescThenKey((entry) => entry.name, (entry) => entry.recentThoughtCount)),
    threadActivity: args.threadActivity
      .map((row) => ({ label: row.label, recentThoughtCount: row.recentThoughtCount }))
      .sort(byCountDescThenKey((entry) => entry.label, (entry) => entry.recentThoughtCount))
      .slice(0, PATTERNS_THREAD_ACTIVITY_LIMIT),
    thoughtCatalog: sortedCatalog,
  }
}

function clampSummary(value: string): string {
  return value.length > PATTERN_ROW_SUMMARY_MAX_LENGTH
    ? value.slice(0, PATTERN_ROW_SUMMARY_MAX_LENGTH)
    : value
}
