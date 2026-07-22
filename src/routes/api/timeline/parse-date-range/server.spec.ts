import { describe, expect, it, vi } from 'vitest'

const { parseDateRangePhraseMock } = vi.hoisted(() => ({
  parseDateRangePhraseMock: vi.fn(),
}))

vi.mock('$lib/server/memory/parse-date-range', () => ({
  parseDateRangePhrase: parseDateRangePhraseMock,
}))

import { POST } from './+server'

function mockEvent(user: { id: string } | null, body: unknown) {
  return {
    locals: { user },
    request: {
      json: async () => body,
    },
  } as Parameters<typeof POST>[0]
}

describe('POST /api/timeline/parse-date-range', () => {
  it('returns 401 when unauthenticated', async () => {
    await expect(POST(mockEvent(null, { phrase: 'last week' }))).rejects.toMatchObject({
      status: 401,
    })
  })

  it('returns parsed range for a phrase', async () => {
    parseDateRangePhraseMock.mockResolvedValueOnce({
      from: '2026-07-14T00:00:00.000Z',
      to: '2026-07-20T23:59:59.999Z',
      includeUndated: false,
      label: 'Last week',
    })

    const res = await POST(
      mockEvent(
        { id: 'u1' },
        { phrase: 'last week', nowIso: '2026-07-21T12:00:00.000Z', timeZone: 'UTC' },
      ),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      from: '2026-07-14T00:00:00.000Z',
      to: '2026-07-20T23:59:59.999Z',
      includeUndated: false,
      label: 'Last week',
    })
    expect(parseDateRangePhraseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        phrase: 'last week',
        nowIso: '2026-07-21T12:00:00.000Z',
        timeZone: 'UTC',
      }),
    )
  })

  it('rejects empty phrase', async () => {
    await expect(POST(mockEvent({ id: 'u1' }, { phrase: '  ' }))).rejects.toMatchObject({
      status: 400,
    })
  })
})
