import { beforeEach, describe, expect, it, vi } from 'vitest'
import { temporalEvent, thought } from '$lib/server/db/schema'

const THOUGHT_ID = '11111111-2222-4333-8444-555555555555'
const EVENT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const TASK_EVENT_ID = `task:${THOUGHT_ID}`

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  decryptTenantValue: vi.fn(async () => 'decrypted text'),
  editStoredThought: vi.fn(async () => undefined),
  archiveTemporalEventForUser: vi.fn(async () => ({ ok: true as const, summary: 'Archived.' })),
  setThoughtLifecycleStatus: vi.fn(),
  syncThoughtIfSingleEvent: vi.fn(async () => undefined),
  buildActivePeriodLiteral: vi.fn(() => '[literal)'),
  applyTemporalEventActionRequest: vi.fn(),
  cancelReminderSchedulesForEvent: vi.fn(async () => undefined),
  syncReminderScheduleForEvent: vi.fn(async () => undefined),
  getTemporalEventListItemById: vi.fn(),
  getUserPreferredTimezone: vi.fn(async () => 'UTC'),
  processPendingGraphSyncJobs: vi.fn(async () => ({ processed: 1, failed: 0 })),
}))

vi.mock('$lib/server/db', () => ({
  getDb: mocks.getDb,
}))

vi.mock('$lib/server/crypto/tenant-encryption', () => ({
  decryptTenantValue: mocks.decryptTenantValue,
}))

vi.mock('$lib/server/capture/service', () => ({
  editStoredThought: mocks.editStoredThought,
}))

vi.mock('$lib/server/memory/lifecycle', () => ({
  archiveTemporalEventForUser: mocks.archiveTemporalEventForUser,
  setThoughtLifecycleStatus: mocks.setThoughtLifecycleStatus,
  syncThoughtIfSingleEvent: mocks.syncThoughtIfSingleEvent,
}))

vi.mock('$lib/server/memory/temporal-normalize', () => ({
  buildActivePeriodLiteral: mocks.buildActivePeriodLiteral,
}))

vi.mock('$lib/server/memory/apply-temporal-event-action', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./apply-temporal-event-action')>()
  return {
    ...actual,
    applyTemporalEventActionRequest: mocks.applyTemporalEventActionRequest,
  }
})

vi.mock('$lib/server/memory/event-reminder-schedule', () => ({
  cancelReminderSchedulesForEvent: mocks.cancelReminderSchedulesForEvent,
  syncReminderScheduleForEvent: mocks.syncReminderScheduleForEvent,
}))

vi.mock('$lib/server/memory/temporal-event-list', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./temporal-event-list')>()
  return {
    ...actual,
    getTemporalEventListItemById: mocks.getTemporalEventListItemById,
  }
})

vi.mock('$lib/server/memory/user-timezone', () => ({
  getUserPreferredTimezone: mocks.getUserPreferredTimezone,
}))

vi.mock('$lib/server/graph/graph-sync-worker', () => ({
  processPendingGraphSyncJobs: mocks.processPendingGraphSyncJobs,
}))

import {
  applyNlTemporalEventAction,
  applyQuickTemporalEventAction,
  applyStructuredRescheduleAction,
  applyStructuredSnoozeAction,
  deleteTemporalEventForUser,
} from './temporal-event-service'

type EventRow = {
  id: string
  kind: string
  semanticSummary: string
  thoughtId: string
  lifecycleStatus: string
  startAt: Date | null
  endAt: Date | null
  snoozedUntil: Date | null
  parseMetadata: Record<string, unknown>
}

function baseEventRow(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: EVENT_ID,
    kind: 'deadline',
    semanticSummary: 'File taxes',
    thoughtId: THOUGHT_ID,
    lifecycleStatus: 'open',
    startAt: new Date('2026-02-01T10:00:00.000Z'),
    endAt: new Date('2026-02-01T11:00:00.000Z'),
    snoozedUntil: null,
    parseMetadata: {},
    ...overrides,
  }
}

function makeGetDb(input: {
  temporalEventRows: EventRow[][]
  thoughtRows?: Array<Record<string, unknown>>[]
  insertReturning?: { id: string }
}) {
  let teCall = 0
  let thCall = 0
  const updateCalls: Array<{ table: unknown; values: unknown }> = []
  const insertCalls: unknown[] = []

  const select = vi.fn(() => ({
    from: vi.fn((table: unknown) => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => {
          if (table === temporalEvent) {
            const idx = Math.min(teCall, input.temporalEventRows.length - 1)
            teCall += 1
            return input.temporalEventRows[idx] ?? []
          }
          if (table === thought) {
            const rows = input.thoughtRows ?? []
            const idx = Math.min(thCall, rows.length - 1)
            thCall += 1
            return rows[idx] ?? []
          }
          return []
        }),
      })),
    })),
  }))

  const update = vi.fn((table: unknown) => ({
    set: vi.fn((values: unknown) => {
      updateCalls.push({ table, values })
      return { where: vi.fn(async () => undefined) }
    }),
  }))

  const insert = vi.fn((table: unknown) => ({
    values: vi.fn((values: unknown) => {
      insertCalls.push({ table, values })
      return {
        returning: vi.fn(async () => [input.insertReturning ?? { id: 'job-1' }]),
      }
    }),
  }))

  mocks.getDb.mockReturnValue({ select, update, insert })
  return { updateCalls, insertCalls }
}

describe('temporal-event-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.decryptTenantValue.mockResolvedValue('decrypted text')
    mocks.getUserPreferredTimezone.mockResolvedValue('UTC')
    mocks.processPendingGraphSyncJobs.mockResolvedValue({ processed: 1, failed: 0 })
    mocks.buildActivePeriodLiteral.mockReturnValue('[literal)')
  })

  describe('applyQuickTemporalEventAction — tasks', () => {
    it('marks a task thought as completed', async () => {
      mocks.setThoughtLifecycleStatus.mockResolvedValue({ ok: true })
      mocks.getTemporalEventListItemById.mockResolvedValue({
        id: TASK_EVENT_ID,
        semanticSummary: 'Buy milk',
      })

      const result = await applyQuickTemporalEventAction('u1', TASK_EVENT_ID, 'mark_done')
      expect(mocks.setThoughtLifecycleStatus).toHaveBeenCalledWith('u1', THOUGHT_ID, 'completed')
      expect(result.summary).toContain('Marked "Buy milk" as done.')
    })

    it('archives a task thought', async () => {
      mocks.setThoughtLifecycleStatus.mockResolvedValue({ ok: true })
      mocks.getTemporalEventListItemById.mockResolvedValue({
        id: TASK_EVENT_ID,
        semanticSummary: 'Buy milk',
      })
      const result = await applyQuickTemporalEventAction('u1', TASK_EVENT_ID, 'archive')
      expect(mocks.setThoughtLifecycleStatus).toHaveBeenCalledWith('u1', THOUGHT_ID, 'archived')
      expect(result.summary).toContain('Archived "Buy milk".')
    })

    it('reopens a task thought', async () => {
      mocks.setThoughtLifecycleStatus.mockResolvedValue({ ok: true })
      mocks.getTemporalEventListItemById.mockResolvedValue({
        id: TASK_EVENT_ID,
        semanticSummary: 'Buy milk',
      })
      const result = await applyQuickTemporalEventAction('u1', TASK_EVENT_ID, 'reopen')
      expect(mocks.setThoughtLifecycleStatus).toHaveBeenCalledWith('u1', THOUGHT_ID, 'open')
      expect(result.summary).toContain('Reopened "Buy milk".')
    })

    it('throws when the task thought is not found', async () => {
      mocks.setThoughtLifecycleStatus.mockResolvedValue({ ok: false })
      await expect(applyQuickTemporalEventAction('u1', TASK_EVENT_ID, 'mark_done')).rejects.toThrow(
        'Task not found',
      )
    })

    it('throws when the task list item cannot be reloaded', async () => {
      mocks.setThoughtLifecycleStatus.mockResolvedValue({ ok: true })
      mocks.getTemporalEventListItemById.mockResolvedValue(null)
      await expect(applyQuickTemporalEventAction('u1', TASK_EVENT_ID, 'mark_done')).rejects.toThrow(
        'Task not found after update',
      )
    })
  })

  describe('applyQuickTemporalEventAction — events', () => {
    it('throws when event is not found', async () => {
      makeGetDb({ temporalEventRows: [[]] })
      await expect(applyQuickTemporalEventAction('u1', EVENT_ID, 'mark_done')).rejects.toThrow(
        'Event not found',
      )
    })

    it('marks an event as done, cancels reminders, and returns the updated item', async () => {
      const row = baseEventRow()
      makeGetDb({ temporalEventRows: [[row], [row]] })
      mocks.getTemporalEventListItemById.mockResolvedValue({
        id: EVENT_ID,
        semanticSummary: row.semanticSummary,
      })

      const result = await applyQuickTemporalEventAction('u1', EVENT_ID, 'mark_done')
      expect(result.summary).toBe('Marked "File taxes" as done.')
      expect(mocks.syncThoughtIfSingleEvent).toHaveBeenCalledWith('u1', THOUGHT_ID, 'completed')
      expect(mocks.cancelReminderSchedulesForEvent).toHaveBeenCalledWith(EVENT_ID)
    })

    it('reopens an event with a start date and reschedules reminders', async () => {
      const row = baseEventRow({ lifecycleStatus: 'archived' })
      makeGetDb({ temporalEventRows: [[row], [row]] })
      mocks.getTemporalEventListItemById.mockResolvedValue({
        id: EVENT_ID,
        semanticSummary: row.semanticSummary,
      })

      const result = await applyQuickTemporalEventAction('u1', EVENT_ID, 'reopen')
      expect(result.summary).toBe('Reopened "File taxes".')
      expect(mocks.syncReminderScheduleForEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          temporalEventId: EVENT_ID,
          lifecycleStatus: 'open',
        }),
      )
    })

    it('throws when the event list item cannot be reloaded after update', async () => {
      const row = baseEventRow()
      makeGetDb({ temporalEventRows: [[row], [row]] })
      mocks.getTemporalEventListItemById.mockResolvedValue(null)
      await expect(applyQuickTemporalEventAction('u1', EVENT_ID, 'mark_done')).rejects.toThrow(
        'Event not found after update',
      )
    })

    it('normalizes legacy quick actions like cancel to archive', async () => {
      const row = baseEventRow()
      makeGetDb({ temporalEventRows: [[row], [row]] })
      mocks.getTemporalEventListItemById.mockResolvedValue({
        id: EVENT_ID,
        semanticSummary: row.semanticSummary,
      })
      const result = await applyQuickTemporalEventAction('u1', EVENT_ID, 'cancel')
      expect(result.summary).toBe('Archived "File taxes".')
    })

    it('rejects an unrecognized action', async () => {
      await expect(
        applyQuickTemporalEventAction('u1', EVENT_ID, 'not_a_real_action' as never),
      ).rejects.toThrow('Invalid temporal event action')
    })

    it('does not enqueue a graph sync job when the event has no start date', async () => {
      const row = baseEventRow({ startAt: null, endAt: null })
      makeGetDb({ temporalEventRows: [[row], [row]] })
      mocks.getTemporalEventListItemById.mockResolvedValue({
        id: EVENT_ID,
        semanticSummary: row.semanticSummary,
      })
      await applyQuickTemporalEventAction('u1', EVENT_ID, 'mark_done')
      expect(mocks.processPendingGraphSyncJobs).not.toHaveBeenCalled()
    })

    it('logs when the background graph sync job fails', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mocks.processPendingGraphSyncJobs.mockRejectedValue(new Error('graph down'))
      const row = baseEventRow()
      const { insertCalls } = makeGetDb({
        temporalEventRows: [[row], [row]],
        insertReturning: { id: 'job-1' },
      })
      mocks.getTemporalEventListItemById.mockResolvedValue({
        id: EVENT_ID,
        semanticSummary: row.semanticSummary,
      })

      await applyQuickTemporalEventAction('u1', EVENT_ID, 'reopen')
      expect(insertCalls).toHaveLength(1)
      await vi.waitFor(() => expect(errSpy).toHaveBeenCalled())
      expect(errSpy).toHaveBeenCalledWith(
        '[temporal-event-service] graph sync failed',
        expect.objectContaining({ eventId: EVENT_ID, message: 'graph down' }),
      )
      errSpy.mockRestore()
    })
  })

  describe('applyNlTemporalEventAction', () => {
    it('rejects natural-language instructions for tasks', async () => {
      await expect(applyNlTemporalEventAction('u1', TASK_EVENT_ID, 'mark done')).rejects.toThrow(
        'Natural-language instructions are not supported for tasks',
      )
    })

    it('throws when the event is not found', async () => {
      makeGetDb({ temporalEventRows: [[]] })
      await expect(
        applyNlTemporalEventAction('u1', EVENT_ID, 'reschedule to tomorrow'),
      ).rejects.toThrow('Event not found')
    })

    it('throws when the source thought is missing', async () => {
      const row = baseEventRow()
      makeGetDb({ temporalEventRows: [[row]], thoughtRows: [[]] })
      await expect(
        applyNlTemporalEventAction('u1', EVENT_ID, 'reschedule to tomorrow'),
      ).rejects.toThrow('Source thought not found')
    })

    it('decrypts thought text when encrypted and applies a thought text patch', async () => {
      const row = baseEventRow()
      makeGetDb({
        temporalEventRows: [[row]],
        thoughtRows: [[{ normalizedText: null, normalizedTextEncrypted: 'cipher' }]],
      })
      mocks.applyTemporalEventActionRequest.mockResolvedValue({
        action: 'update',
        thoughtTextPatch: 'Updated thought text',
        summary: 'Updated the note.',
      })
      mocks.getTemporalEventListItemById.mockResolvedValue({
        id: EVENT_ID,
        semanticSummary: row.semanticSummary,
      })

      const result = await applyNlTemporalEventAction('u1', EVENT_ID, 'reword this')
      expect(mocks.decryptTenantValue).toHaveBeenCalled()
      expect(mocks.editStoredThought).toHaveBeenCalledWith('u1', THOUGHT_ID, 'Updated thought text')
      expect(result.summary).toBe('Updated the note.')
    })

    it('falls through to lifecycle patch when reloaded item is missing after a thought text patch', async () => {
      const row = baseEventRow()
      makeGetDb({
        temporalEventRows: [[row], [row]],
        thoughtRows: [[{ normalizedText: 'Plain text', normalizedTextEncrypted: null }]],
      })
      mocks.applyTemporalEventActionRequest.mockResolvedValue({
        action: 'update',
        thoughtTextPatch: 'Updated thought text',
        summary: 'Updated the note.',
      })
      mocks.getTemporalEventListItemById
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: EVENT_ID, semanticSummary: row.semanticSummary })

      const result = await applyNlTemporalEventAction('u1', EVENT_ID, 'reword this')
      expect(result.summary).toBe('Updated the note.')
    })

    it('applies a reschedule action without a thought text patch', async () => {
      const row = baseEventRow()
      makeGetDb({
        temporalEventRows: [[row], [row]],
        thoughtRows: [[{ normalizedText: 'Plain text', normalizedTextEncrypted: null }]],
      })
      mocks.applyTemporalEventActionRequest.mockResolvedValue({
        action: 'reschedule',
        lifecycleStatus: 'open',
        startAt: '2026-03-01T10:00:00.000Z',
        endAt: '2026-03-01T11:00:00.000Z',
        summary: 'Rescheduled.',
      })
      mocks.getTemporalEventListItemById.mockResolvedValue({
        id: EVENT_ID,
        semanticSummary: row.semanticSummary,
      })

      const result = await applyNlTemporalEventAction('u1', EVENT_ID, 'move to march 1st')
      expect(result.summary).toBe('Rescheduled.')
    })

    it('throws when the LLM returns an unparseable startAt', async () => {
      const row = baseEventRow()
      makeGetDb({
        temporalEventRows: [[row]],
        thoughtRows: [[{ normalizedText: 'Plain text', normalizedTextEncrypted: null }]],
      })
      mocks.applyTemporalEventActionRequest.mockResolvedValue({
        action: 'reschedule',
        startAt: 'not-a-date',
        summary: 'Rescheduled.',
      })
      await expect(applyNlTemporalEventAction('u1', EVENT_ID, 'move to garbage')).rejects.toThrow(
        'Invalid startAt from action',
      )
    })

    it('throws when the LLM returns an unparseable endAt', async () => {
      const row = baseEventRow()
      makeGetDb({
        temporalEventRows: [[row]],
        thoughtRows: [[{ normalizedText: 'Plain text', normalizedTextEncrypted: null }]],
      })
      mocks.applyTemporalEventActionRequest.mockResolvedValue({
        action: 'reschedule',
        startAt: '2026-03-01T10:00:00.000Z',
        endAt: 'not-a-date',
        summary: 'Rescheduled.',
      })
      await expect(applyNlTemporalEventAction('u1', EVENT_ID, 'move to garbage')).rejects.toThrow(
        'Invalid endAt from action',
      )
    })

    it('throws when the LLM returns an unparseable snoozedUntil', async () => {
      const row = baseEventRow()
      makeGetDb({
        temporalEventRows: [[row]],
        thoughtRows: [[{ normalizedText: 'Plain text', normalizedTextEncrypted: null }]],
      })
      mocks.applyTemporalEventActionRequest.mockResolvedValue({
        action: 'snooze',
        snoozedUntil: 'not-a-date',
        summary: 'Snoozed.',
      })
      await expect(applyNlTemporalEventAction('u1', EVENT_ID, 'snooze forever')).rejects.toThrow(
        'Invalid snoozedUntil from action',
      )
    })

    it('clears startAt/endAt when the action explicitly nulls them out', async () => {
      const row = baseEventRow()
      makeGetDb({
        temporalEventRows: [[row], [row]],
        thoughtRows: [[{ normalizedText: 'Plain text', normalizedTextEncrypted: null }]],
      })
      mocks.applyTemporalEventActionRequest.mockResolvedValue({
        action: 'update',
        startAt: null,
        endAt: null,
        summary: 'Cleared schedule.',
      })
      mocks.getTemporalEventListItemById.mockResolvedValue({
        id: EVENT_ID,
        semanticSummary: row.semanticSummary,
      })

      const result = await applyNlTemporalEventAction('u1', EVENT_ID, 'unschedule this')
      expect(result.summary).toBe('Cleared schedule.')
      expect(mocks.cancelReminderSchedulesForEvent).toHaveBeenCalledWith(EVENT_ID)
    })

    it('throws when the event cannot be reloaded after applying the lifecycle patch', async () => {
      const row = baseEventRow()
      makeGetDb({
        temporalEventRows: [[row], [row]],
        thoughtRows: [[{ normalizedText: 'Plain text', normalizedTextEncrypted: null }]],
      })
      mocks.applyTemporalEventActionRequest.mockResolvedValue({
        action: 'update',
        summary: 'Updated.',
      })
      mocks.getTemporalEventListItemById.mockResolvedValue(null)
      await expect(applyNlTemporalEventAction('u1', EVENT_ID, 'update this')).rejects.toThrow(
        'Event not found after update',
      )
    })
  })

  describe('applyStructuredRescheduleAction', () => {
    it('rejects rescheduling for tasks', async () => {
      await expect(
        applyStructuredRescheduleAction('u1', TASK_EVENT_ID, {
          startAt: '2026-03-01T10:00:00.000Z',
        }),
      ).rejects.toThrow('Rescheduling is not supported for tasks.')
    })

    it('throws when event is not found', async () => {
      makeGetDb({ temporalEventRows: [[]] })
      await expect(
        applyStructuredRescheduleAction('u1', EVENT_ID, { startAt: '2026-03-01T10:00:00.000Z' }),
      ).rejects.toThrow('Event not found')
    })

    it('rejects an invalid startAt', async () => {
      const row = baseEventRow()
      makeGetDb({ temporalEventRows: [[row]] })
      await expect(
        applyStructuredRescheduleAction('u1', EVENT_ID, { startAt: 'garbage' }),
      ).rejects.toThrow('Invalid startAt')
    })

    it('rejects an invalid endAt', async () => {
      const row = baseEventRow()
      makeGetDb({ temporalEventRows: [[row]] })
      await expect(
        applyStructuredRescheduleAction('u1', EVENT_ID, {
          startAt: '2026-03-01T10:00:00.000Z',
          endAt: 'garbage',
        }),
      ).rejects.toThrow('Invalid endAt')
    })

    it('reschedules with an explicit end time', async () => {
      const row = baseEventRow()
      makeGetDb({
        temporalEventRows: [[row], [row]],
        insertReturning: { id: 'job-1' },
      })
      mocks.getTemporalEventListItemById.mockResolvedValue({
        id: EVENT_ID,
        semanticSummary: row.semanticSummary,
      })

      const result = await applyStructuredRescheduleAction('u1', EVENT_ID, {
        startAt: '2026-03-01T10:00:00.000Z',
        endAt: '2026-03-01T12:00:00.000Z',
      })
      expect(result.summary).toContain('Rescheduled "File taxes"')
      expect(mocks.processPendingGraphSyncJobs).toHaveBeenCalled()
    })

    it('defaults the end time to one hour after start when omitted', async () => {
      const row = baseEventRow()
      makeGetDb({ temporalEventRows: [[row], [row]] })
      mocks.getTemporalEventListItemById.mockResolvedValue({
        id: EVENT_ID,
        semanticSummary: row.semanticSummary,
      })

      await applyStructuredRescheduleAction('u1', EVENT_ID, {
        startAt: '2026-03-01T10:00:00.000Z',
      })
      expect(mocks.buildActivePeriodLiteral).toHaveBeenCalledWith(
        new Date('2026-03-01T10:00:00.000Z'),
        new Date('2026-03-01T11:00:00.000Z'),
      )
    })

    it('throws when the event cannot be reloaded after rescheduling', async () => {
      const row = baseEventRow()
      makeGetDb({ temporalEventRows: [[row], [row]] })
      mocks.getTemporalEventListItemById.mockResolvedValue(null)
      await expect(
        applyStructuredRescheduleAction('u1', EVENT_ID, { startAt: '2026-03-01T10:00:00.000Z' }),
      ).rejects.toThrow('Event not found after update')
    })
  })

  describe('applyStructuredSnoozeAction', () => {
    it('rejects snoozing for tasks', async () => {
      await expect(
        applyStructuredSnoozeAction('u1', TASK_EVENT_ID, '2026-03-01T10:00:00.000Z'),
      ).rejects.toThrow('Snoozing is not supported for tasks.')
    })

    it('throws when event is not found', async () => {
      makeGetDb({ temporalEventRows: [[]] })
      await expect(
        applyStructuredSnoozeAction('u1', EVENT_ID, '2026-03-01T10:00:00.000Z'),
      ).rejects.toThrow('Event not found')
    })

    it('rejects an invalid snoozedUntil', async () => {
      const row = baseEventRow()
      makeGetDb({ temporalEventRows: [[row]] })
      await expect(applyStructuredSnoozeAction('u1', EVENT_ID, 'garbage')).rejects.toThrow(
        'Invalid snoozedUntil',
      )
    })

    it('snoozes an event and keeps existing bounds', async () => {
      const row = baseEventRow()
      makeGetDb({ temporalEventRows: [[row], [row]] })
      mocks.getTemporalEventListItemById.mockResolvedValue({
        id: EVENT_ID,
        semanticSummary: row.semanticSummary,
      })

      const result = await applyStructuredSnoozeAction('u1', EVENT_ID, '2026-03-01T10:00:00.000Z')
      expect(result.summary).toContain('Snoozed "File taxes" until')
      expect(mocks.syncReminderScheduleForEvent).toHaveBeenCalled()
    })

    it('throws when the event cannot be reloaded after snoozing', async () => {
      const row = baseEventRow()
      makeGetDb({ temporalEventRows: [[row], [row]] })
      mocks.getTemporalEventListItemById.mockResolvedValue(null)
      await expect(
        applyStructuredSnoozeAction('u1', EVENT_ID, '2026-03-01T10:00:00.000Z'),
      ).rejects.toThrow('Event not found after update')
    })
  })

  describe('deleteTemporalEventForUser', () => {
    it('delegates to archiveTemporalEventForUser', async () => {
      const result = await deleteTemporalEventForUser('u1', EVENT_ID)
      expect(mocks.archiveTemporalEventForUser).toHaveBeenCalledWith('u1', EVENT_ID)
      expect(result).toEqual({ ok: true, summary: 'Archived.' })
    })
  })
})
