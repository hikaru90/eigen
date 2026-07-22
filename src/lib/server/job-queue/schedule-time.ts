/** Calendar date YYYY-MM-DD in an IANA timezone. */
export function calendarDateInTimezone(when: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(when)
  const y = parts.find((p) => p.type === 'year')?.value
  const m = parts.find((p) => p.type === 'month')?.value
  const d = parts.find((p) => p.type === 'day')?.value
  if (!y || !m || !d) {
    throw new Error(`Failed to format calendar date in timezone ${timeZone}`)
  }
  return `${y}-${m}-${d}`
}

/** UTC instant for a local wall-clock time on a calendar date in a timezone. */
export function localScheduleToUtc(
  runNight: string,
  runHour: number,
  runMinute: number,
  timeZone: string,
): Date {
  const [y, m, d] = runNight.split('-').map((v) => Number.parseInt(v, 10))
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    throw new Error(`Invalid run night: ${runNight}`)
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  })

  const target = { year: y, month: m, day: d, hour: runHour, minute: runMinute }
  let ts = Date.UTC(y, m - 1, d, runHour, runMinute, 0)

  for (let i = 0; i < 48; i++) {
    const parts = formatter.formatToParts(new Date(ts))
    const hourRaw = parts.find((p) => p.type === 'hour')?.value ?? '0'
    const got = {
      year: Number(parts.find((p) => p.type === 'year')?.value),
      month: Number(parts.find((p) => p.type === 'month')?.value),
      day: Number(parts.find((p) => p.type === 'day')?.value),
      hour: Number(hourRaw === '24' ? '0' : hourRaw),
      minute: Number(parts.find((p) => p.type === 'minute')?.value),
    }
    if (
      got.year === target.year &&
      got.month === target.month &&
      got.day === target.day &&
      got.hour === target.hour &&
      got.minute === target.minute
    ) {
      return new Date(ts)
    }
    const gotMinutes = got.hour * 60 + got.minute
    const targetMinutes = target.hour * 60 + target.minute
    const dayDiff = got.day - target.day
    ts -= (dayDiff * 24 * 60 + (gotMinutes - targetMinutes)) * 60_000
  }

  throw new Error(`Failed to resolve local schedule in ${timeZone}`)
}

export function formatScheduleLabel(runHour: number, runMinute: number, timeZone: string): string {
  const hour12 = runHour % 12 === 0 ? 12 : runHour % 12
  const ampm = runHour < 12 ? 'AM' : 'PM'
  const minute = String(runMinute).padStart(2, '0')
  if (runHour === 2 && runMinute === 0) {
    return `Every day at 2:00 AM (${timeZone})`
  }
  return `Every day at ${hour12}:${minute} ${ampm} (${timeZone})`
}
