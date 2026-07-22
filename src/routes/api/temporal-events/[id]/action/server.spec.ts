import { describe, expect, it, vi, beforeEach } from 'vitest'
import { POST } from './+server'

const {
  applyNlTemporalEventActionMock,
  applyQuickTemporalEventActionMock,
  applyStructuredRescheduleActionMock,
  applyStructuredSnoozeActionMock,
} = vi.hoisted(() => ({
  applyNlTemporalEventActionMock: vi.fn(),
  applyQuickTemporalEventActionMock: vi.fn(),
  applyStructuredRescheduleActionMock: vi.fn(),
  applyStructuredSnoozeActionMock: vi.fn(),
}))

vi.mock('$lib/server/memory/temporal-event-service', () => ({
  applyNlTemporalEventAction: applyNlTemporalEventActionMock,
  applyQuickTemporalEventAction: applyQuickTemporalEventActionMock,
  applyStructuredRescheduleAction: applyStructuredRescheduleActionMock,
  applyStructuredSnoozeAction: applyStructuredSnoozeActionMock,
}))

function event(overrides: { user?: { id: string } | null; id?: string; body?: unknown } = {}) {
  return {
    locals: { user: overrides.user === undefined ? { id: 'u1' } : overrides.user },
    params: { id: overrides.id ?? 'ev-1' },
    request: new Request('http://localhost/api/temporal-events/ev-1/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(overrides.body ?? {}),
    }),
  } as Parameters<typeof POST>[0]
}

describe('POST /api/temporal-events/[id]/action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    await expect(POST(event({ user: null }))).rejects.toMatchObject({ status: 401 })
  })

  it('returns 400 when event id is missing', async () => {
    await expect(POST(event({ id: '  ' }))).rejects.toMatchObject({ status: 400 })
  })

  it('returns 400 for invalid JSON body', async () => {
    await expect(
      POST({
        locals: { user: { id: 'u1' } },
        params: { id: 'ev-1' },
        request: new Request('http://localhost', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: 'not-json',
        }),
      } as Parameters<typeof POST>[0]),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('reschedules the event', async () => {
    applyStructuredRescheduleActionMock.mockResolvedValue({ ok: true })
    const res = await POST(
      event({ body: { action: 'reschedule', startAt: '2026-06-01T00:00:00.000Z' } }),
    )
    expect(applyStructuredRescheduleActionMock).toHaveBeenCalledWith('u1', 'ev-1', {
      startAt: '2026-06-01T00:00:00.000Z',
      endAt: null,
    })
    expect(res.status).toBe(200)
  })

  it('requires startAt for reschedule', async () => {
    await expect(POST(event({ body: { action: 'reschedule' } }))).rejects.toMatchObject({
      status: 400,
    })
  })

  it('returns 404 when reschedule target not found', async () => {
    applyStructuredRescheduleActionMock.mockRejectedValue(new Error('Event not found'))
    await expect(
      POST(event({ body: { action: 'reschedule', startAt: '2026-06-01T00:00:00.000Z' } })),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('snoozes the event', async () => {
    applyStructuredSnoozeActionMock.mockResolvedValue({ ok: true })
    const res = await POST(
      event({ body: { action: 'snooze', snoozedUntil: '2026-06-02T00:00:00.000Z' } }),
    )
    expect(applyStructuredSnoozeActionMock).toHaveBeenCalledWith(
      'u1',
      'ev-1',
      '2026-06-02T00:00:00.000Z',
    )
    expect(res.status).toBe(200)
  })

  it('requires snoozedUntil for snooze', async () => {
    await expect(POST(event({ body: { action: 'snooze' } }))).rejects.toMatchObject({
      status: 400,
    })
  })

  it('applies a quick action', async () => {
    applyQuickTemporalEventActionMock.mockResolvedValue({ ok: true })
    const res = await POST(event({ body: { action: 'mark_done' } }))
    expect(applyQuickTemporalEventActionMock).toHaveBeenCalledWith('u1', 'ev-1', 'mark_done')
    expect(res.status).toBe(200)
  })

  it('returns 404 when quick action target not found', async () => {
    applyQuickTemporalEventActionMock.mockRejectedValue(new Error('not found'))
    await expect(POST(event({ body: { action: 'archive' } }))).rejects.toMatchObject({
      status: 404,
    })
  })

  it('applies a natural-language instruction', async () => {
    applyNlTemporalEventActionMock.mockResolvedValue({ ok: true })
    const res = await POST(event({ body: { instruction: 'move to next week' } }))
    expect(applyNlTemporalEventActionMock).toHaveBeenCalledWith('u1', 'ev-1', 'move to next week')
    expect(res.status).toBe(200)
  })

  it('returns 400 when neither action nor instruction is provided', async () => {
    await expect(POST(event({ body: {} }))).rejects.toMatchObject({ status: 400 })
  })
})
