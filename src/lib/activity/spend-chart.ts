export type ActivitySpendBucket = {
  periodStart: string
  totalCostUsd: string
  callCount: number
  groupCount: number
}

export type ActivitySpendBucketUnit = 'day' | 'week' | 'month'

export function chooseActivitySpendBucketUnit(spanDays: number): ActivitySpendBucketUnit {
  if (spanDays <= 31) return 'day'
  if (spanDays <= 180) return 'week'
  return 'month'
}

export function utcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function startOfUtcPeriod(d: Date, unit: ActivitySpendBucketUnit): Date {
  const y = d.getUTCFullYear()
  const month = d.getUTCMonth()
  const day = d.getUTCDate()
  if (unit === 'day') return new Date(Date.UTC(y, month, day))
  if (unit === 'month') return new Date(Date.UTC(y, month, 1))
  const dow = d.getUTCDay()
  const diff = dow === 0 ? 6 : dow - 1
  return new Date(Date.UTC(y, month, day - diff))
}

export function advanceUtcPeriod(d: Date, unit: ActivitySpendBucketUnit): Date {
  const next = new Date(d)
  if (unit === 'day') {
    next.setUTCDate(next.getUTCDate() + 1)
  } else if (unit === 'week') {
    next.setUTCDate(next.getUTCDate() + 7)
  } else {
    next.setUTCMonth(next.getUTCMonth() + 1)
  }
  return next
}

export function callTimestampBounds(calls: Array<{ createdAt: string | Date }>): {
  earliest: Date | null
  latest: Date | null
} {
  if (calls.length === 0) return { earliest: null, latest: null }
  let earliest = new Date(calls[0].createdAt)
  let latest = earliest
  for (const call of calls) {
    const d = new Date(call.createdAt)
    if (d < earliest) earliest = d
    if (d > latest) latest = d
  }
  return { earliest, latest }
}

export function computeActivitySpendSpan(input: {
  from: Date | null
  to: Date | null
  earliestCallAt: Date | null
  latestCallAt?: Date | null
}): { from: Date; to: Date; spanDays: number } {
  const to = input.to ?? input.latestCallAt ?? new Date()
  let from: Date
  if (input.from) {
    from = input.from
  } else if (input.earliestCallAt) {
    from = input.earliestCallAt
  } else {
    from = new Date(to)
    from.setUTCDate(from.getUTCDate() - 30)
  }
  if (from.getTime() > to.getTime()) {
    from = new Date(to)
  }
  const spanDays = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86_400_000))
  return { from, to, spanDays }
}

/** Fill missing periods with zero spend so the chart has a continuous x-axis. */
export function fillActivitySpendBuckets(
  rows: ActivitySpendBucket[],
  from: Date,
  to: Date,
  unit: ActivitySpendBucketUnit,
): ActivitySpendBucket[] {
  const byKey = new Map(rows.map((row) => [row.periodStart, row]))
  const filled: ActivitySpendBucket[] = []
  let rangeFrom = from
  let rangeTo = to
  for (const row of rows) {
    const periodAt = new Date(`${row.periodStart}T00:00:00.000Z`)
    if (periodAt < rangeFrom) rangeFrom = periodAt
    if (periodAt > rangeTo) rangeTo = periodAt
  }
  const rangeStart = startOfUtcPeriod(rangeFrom, unit)
  const rangeEnd = startOfUtcPeriod(rangeTo, unit)

  for (
    let cursor = rangeStart;
    cursor.getTime() <= rangeEnd.getTime();
    cursor = advanceUtcPeriod(cursor, unit)
  ) {
    const key = utcDateKey(cursor)
    filled.push(
      byKey.get(key) ?? {
        periodStart: key,
        totalCostUsd: '0.000000',
        callCount: 0,
        groupCount: 0,
      },
    )
  }

  return filled
}

export function formatActivitySpendBucketLabel(
  periodStart: string,
  unit: ActivitySpendBucketUnit,
): string {
  const d = new Date(`${periodStart}T00:00:00.000Z`)
  if (unit === 'month') {
    return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' })
  }
  if (unit === 'week') {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
