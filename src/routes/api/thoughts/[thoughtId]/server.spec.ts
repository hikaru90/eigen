import { describe, expect, it, vi } from 'vitest'
import { DELETE, GET, PATCH } from './+server'

const { archiveThoughtForUserMock, setThoughtLifecycleStatusMock, getDbSelectMock } = vi.hoisted(
  () => ({
    archiveThoughtForUserMock: vi.fn(),
    setThoughtLifecycleStatusMock: vi.fn(),
    getDbSelectMock: vi.fn(),
  }),
)

vi.mock('$lib/server/memory/lifecycle', () => ({
  archiveThoughtForUser: archiveThoughtForUserMock,
  setThoughtLifecycleStatus: setThoughtLifecycleStatusMock,
}))

vi.mock('$lib/server/text-files/service', () => ({
  listTextFilesForThought: vi.fn(async () => []),
}))

vi.mock('$lib/server/db', () => ({
  getDb: () => ({
    select: getDbSelectMock,
  }),
}))

describe('GET /api/thoughts/[thoughtId]', () => {
  it('requires auth', async () => {
    await expect(
      GET({ locals: { user: null }, params: { thoughtId: 't1' } } as never),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('returns thought row', async () => {
    getDbSelectMock.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => [
            { id: 't1', rawText: 'a', normalizedText: 'a', category: 'task' },
          ]),
        })),
      })),
    })
    const res = await GET({
      locals: { user: { id: 'u1' } },
      params: { thoughtId: 't1' },
    } as never)
    expect(res.status).toBe(200)
  })
})

describe('PATCH /api/thoughts/[thoughtId]', () => {
  it('requires auth', async () => {
    await expect(
      PATCH({
        locals: { user: null },
        params: { thoughtId: 't1' },
        request: new Request('http://localhost', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'completed' }),
        }),
      } as never),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('rejects invalid status', async () => {
    await expect(
      PATCH({
        locals: { user: { id: 'u1' } },
        params: { thoughtId: 't1' },
        request: new Request('http://localhost', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'done' }),
        }),
      } as never),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('returns 404 when thought is missing', async () => {
    setThoughtLifecycleStatusMock.mockResolvedValue({ ok: false, reason: 'not_found' })
    await expect(
      PATCH({
        locals: { user: { id: 'u1' } },
        params: { thoughtId: 't1' },
        request: new Request('http://localhost', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'completed' }),
        }),
      } as never),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('sets status and returns thought', async () => {
    setThoughtLifecycleStatusMock.mockResolvedValue({
      ok: true,
      thought: {
        id: 't1',
        metadata: { status: 'completed', completedAt: '2026-01-01T00:00:00.000Z' },
      },
    })
    const res = await PATCH({
      locals: { user: { id: 'u1' } },
      params: { thoughtId: 't1' },
      request: new Request('http://localhost', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      }),
    } as never)
    expect(res.status).toBe(200)
    expect(setThoughtLifecycleStatusMock).toHaveBeenCalledWith('u1', 't1', 'completed')
    const body = await res.json()
    expect(body.thought.metadata.status).toBe('completed')
  })
})

describe('DELETE /api/thoughts/[thoughtId]', () => {
  it('requires auth', async () => {
    await expect(
      DELETE({ locals: { user: null }, params: { thoughtId: 't1' } } as never),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('returns 404 when archiveThoughtForUser reports not found', async () => {
    archiveThoughtForUserMock.mockResolvedValue({ ok: false, reason: 'not_found' })
    await expect(
      DELETE({ locals: { user: { id: 'u1' } }, params: { thoughtId: 't1' } } as never),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('returns ok when archived', async () => {
    archiveThoughtForUserMock.mockResolvedValue({ ok: true })
    const res = await DELETE({
      locals: { user: { id: 'u1' } },
      params: { thoughtId: 't1' },
    } as never)
    expect(res.status).toBe(200)
    expect(archiveThoughtForUserMock).toHaveBeenCalledWith('u1', 't1')
    const body = await res.json()
    expect(body).toEqual({ ok: true, archived: true })
  })
})
