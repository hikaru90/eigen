/**
 * The meta line's long date (ei app.js:67-71 `longDate`): weekday, day and month, then
 * the clock — from `Intl` in the UI locale and the user's preferred timezone, the way
 * Yarn formats its times (src/lib/mesh/day-groups.ts). No copy of our own.
 */

export type LongDateOptions = { locale: string; timeZone: string }

export function longDateLabel(iso: string, opts: LongDateOptions): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const day = new Intl.DateTimeFormat(opts.locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: opts.timeZone,
  }).format(d)
  const clock = new Intl.DateTimeFormat(opts.locale, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: opts.timeZone,
  }).format(d)
  return `${day} · ${clock}`
}
