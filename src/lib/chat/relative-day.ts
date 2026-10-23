/**
 * A quiet relative day for Ask's sessions and sources (ei `ago()`): "today", "yesterday",
 * "3 days ago", then a short date. Words come from `Intl` in the UI locale — no hardcoded
 * copy in either language.
 */
const DAY_MS = 86_400_000

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function relativeDayLabel(iso: string, now: Date = new Date(), locale = 'en'): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const days = Math.round((startOfLocalDay(now) - startOfLocalDay(d)) / DAY_MS)
  if (days >= 0 && days < 7) {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-days, 'day')
  }
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric'
  return d.toLocaleDateString(locale, opts)
}
