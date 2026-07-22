import { buildDailySummaryPush } from '$lib/server/memory/daily-summary'
import { listTemporalEventsForUser } from '$lib/server/memory/temporal-event-list'
import {
  formatMinutesLocal,
  localDayKey,
  localMinutesSinceMidnight,
} from '$lib/server/memory/timeline-today-server'
import { getUserPreferredTimezone } from '$lib/server/memory/user-timezone'

export type DailySummaryDispatchReason =
  'sent_today' | 'due_now' | 'before_window' | 'no_push_device' | 'send_failed'

export type DailySummaryDispatchEvaluation = {
  reason: DailySummaryDispatchReason
  todayLocalDate: string
  currentMinutesLocal: number
  scheduledMinutesLocal: number
  scheduledTimeLocal: string
  windowStartMinutes: number
  windowEndMinutes: number
  windowStartLocal: string
  windowEndLocal: string
  wouldDispatch: boolean
  lastDispatchError: string | null
}

export type DailySummaryPreview = {
  title: string
  body: string
  url: string
}

export function evaluateDailySummaryDispatch(input: {
  now: Date
  timeZone: string
  dailySummaryMinutesLocal: number
  lastDailySummaryLocalDate: string | null
  lastDailySummaryDispatchError: string | null
  pushDeviceCount: number
}): DailySummaryDispatchEvaluation {
  const todayLocalDate = localDayKey(input.now.toISOString(), input.timeZone)
  const currentMinutesLocal = localMinutesSinceMidnight(input.now, input.timeZone)
  const scheduledMinutesLocal = input.dailySummaryMinutesLocal
  const windowStartMinutes = scheduledMinutesLocal
  const windowEndMinutes = 24 * 60
  const lastDispatchError = input.lastDailySummaryDispatchError?.trim() || null

  if (input.lastDailySummaryLocalDate === todayLocalDate && lastDispatchError === null) {
    return buildEvaluation({
      reason: 'sent_today',
      todayLocalDate,
      currentMinutesLocal,
      scheduledMinutesLocal,
      windowStartMinutes,
      windowEndMinutes,
      wouldDispatch: false,
      lastDispatchError: null,
    })
  }

  if (input.pushDeviceCount === 0) {
    return buildEvaluation({
      reason: 'no_push_device',
      todayLocalDate,
      currentMinutesLocal,
      scheduledMinutesLocal,
      windowStartMinutes,
      windowEndMinutes,
      wouldDispatch: false,
      lastDispatchError,
    })
  }

  if (currentMinutesLocal < windowStartMinutes) {
    return buildEvaluation({
      reason: 'before_window',
      todayLocalDate,
      currentMinutesLocal,
      scheduledMinutesLocal,
      windowStartMinutes,
      windowEndMinutes,
      wouldDispatch: false,
      lastDispatchError,
    })
  }

  if (lastDispatchError !== null) {
    return buildEvaluation({
      reason: 'send_failed',
      todayLocalDate,
      currentMinutesLocal,
      scheduledMinutesLocal,
      windowStartMinutes,
      windowEndMinutes,
      wouldDispatch: true,
      lastDispatchError,
    })
  }

  return buildEvaluation({
    reason: 'due_now',
    todayLocalDate,
    currentMinutesLocal,
    scheduledMinutesLocal,
    windowStartMinutes,
    windowEndMinutes,
    wouldDispatch: true,
    lastDispatchError: null,
  })
}

function buildEvaluation(input: {
  reason: DailySummaryDispatchReason
  todayLocalDate: string
  currentMinutesLocal: number
  scheduledMinutesLocal: number
  windowStartMinutes: number
  windowEndMinutes: number
  wouldDispatch: boolean
  lastDispatchError: string | null
}): DailySummaryDispatchEvaluation {
  return {
    reason: input.reason,
    todayLocalDate: input.todayLocalDate,
    currentMinutesLocal: input.currentMinutesLocal,
    scheduledMinutesLocal: input.scheduledMinutesLocal,
    scheduledTimeLocal: formatMinutesLocal(input.scheduledMinutesLocal),
    windowStartMinutes: input.windowStartMinutes,
    windowEndMinutes: input.windowEndMinutes,
    windowStartLocal: formatMinutesLocal(input.windowStartMinutes),
    windowEndLocal: 'end of day',
    wouldDispatch: input.wouldDispatch,
    lastDispatchError: input.lastDispatchError,
  }
}

export function dailySummaryDispatchReasonLabel(
  reason: DailySummaryDispatchReason,
  lastDispatchError: string | null = null,
): string {
  switch (reason) {
    case 'sent_today':
      return 'Delivered today'
    case 'due_now':
      return 'Due — will send on next tick'
    case 'before_window':
      return 'Before scheduled time today'
    case 'no_push_device':
      return 'No push device registered'
    case 'send_failed':
      return lastDispatchError
        ? `Last send failed — ${lastDispatchError}`
        : 'Last send failed — will retry'
  }
}

export async function buildDailySummaryPreviewForUser(
  userId: string,
  now = new Date(),
): Promise<DailySummaryPreview> {
  const timeZone = await getUserPreferredTimezone(userId)
  const [{ items: openItems }, { items: allItems }] = await Promise.all([
    listTemporalEventsForUser({
      userId,
      status: 'open',
      range: 'all',
      includeTasks: true,
    }),
    listTemporalEventsForUser({
      userId,
      status: 'all',
      range: 'all',
      includeTasks: true,
    }),
  ])
  return buildDailySummaryPush(openItems, allItems, timeZone, now)
}
