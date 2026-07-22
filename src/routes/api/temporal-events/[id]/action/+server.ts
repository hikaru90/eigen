import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import {
  applyNlTemporalEventAction,
  applyQuickTemporalEventAction,
  applyStructuredRescheduleAction,
  applyStructuredSnoozeAction,
} from '$lib/server/memory/temporal-event-service'
import type { TemporalEventActionInput } from '$lib/server/memory/apply-temporal-event-action'

export const POST: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const eventId = event.params.id?.trim()
  if (!eventId) error(400, 'Event id is required')

  let body: {
    action?: string
    instruction?: string
    startAt?: string
    endAt?: string | null
    snoozedUntil?: string
  }
  try {
    body = await event.request.json()
  } catch {
    error(400, 'Invalid JSON body')
  }

  const action = typeof body.action === 'string' ? body.action.trim() : ''
  const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : ''

  if (action === 'reschedule') {
    const startAt = typeof body.startAt === 'string' ? body.startAt.trim() : ''
    if (!startAt) error(400, 'startAt is required for reschedule')
    try {
      const result = await applyStructuredRescheduleAction(user.id, eventId, {
        startAt,
        endAt: typeof body.endAt === 'string' ? body.endAt : (body.endAt ?? null),
      })
      return json(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('not found')) error(404, message)
      error(400, message)
    }
  }

  if (action === 'snooze') {
    const snoozedUntil = typeof body.snoozedUntil === 'string' ? body.snoozedUntil.trim() : ''
    if (!snoozedUntil) error(400, 'snoozedUntil is required for snooze')
    try {
      const result = await applyStructuredSnoozeAction(user.id, eventId, snoozedUntil)
      return json(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('not found')) error(404, message)
      error(400, message)
    }
  }

  const quickActions = new Set(['mark_done', 'reopen', 'archive', 'cancel', 'dismiss', 'delete'])
  if (action && quickActions.has(action)) {
    try {
      const result = await applyQuickTemporalEventAction(
        user.id,
        eventId,
        action as TemporalEventActionInput,
      )
      return json(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('not found')) error(404, message)
      error(400, message)
    }
  }

  if (instruction) {
    try {
      const result = await applyNlTemporalEventAction(user.id, eventId, instruction)
      return json(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('not found')) error(404, message)
      error(400, message)
    }
  }

  error(400, 'Provide action (mark_done|reopen|archive) or instruction')
}
