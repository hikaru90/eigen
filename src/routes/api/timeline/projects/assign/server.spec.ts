import { describe, expect, it, vi } from 'vitest'
import { DELETE, POST } from './+server'

const { assignThoughtToProjectMock, unassignThoughtFromProjectMock } = vi.hoisted(() => ({
  assignThoughtToProjectMock: vi.fn(),
  unassignThoughtFromProjectMock: vi.fn(),
}))

vi.mock('$lib/server/memory/assign-thought-project', () => ({
  assignThoughtToProject: assignThoughtToProjectMock,
  unassignThoughtFromProject: unassignThoughtFromProjectMock,
}))

function event(overrides: { user?: { id: string } | null; body?: unknown } = {}) {
  return {
    locals: { user: overrides.user === undefined ? { id: 'u1' } : overrides.user },
    request: new Request('http://localhost/api/timeline/projects/assign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(overrides.body ?? {}),
    }),
  } as Parameters<typeof POST>[0]
}

describe('POST /api/timeline/projects/assign', () => {
  it('returns 401 when unauthenticated', async () => {
    await expect(POST(event({ user: null }))).rejects.toMatchObject({ status: 401 })
  })

  it('returns 400 for invalid JSON body', async () => {
    await expect(
      POST({
        locals: { user: { id: 'u1' } },
        request: new Request('http://localhost', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: 'not-json',
        }),
      } as Parameters<typeof POST>[0]),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('returns 400 when thoughtId is missing', async () => {
    await expect(POST(event({ body: { projectEntityId: 'ent-1' } }))).rejects.toMatchObject({
      status: 400,
    })
  })

  it('returns 400 when both projectEntityId and projectLabel are provided', async () => {
    await expect(
      POST(
        event({
          body: { thoughtId: 't1', projectEntityId: 'ent-1', projectLabel: 'Label' },
        }),
      ),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('returns 400 when neither projectEntityId nor projectLabel is provided', async () => {
    await expect(POST(event({ body: { thoughtId: 't1' } }))).rejects.toMatchObject({
      status: 400,
    })
  })

  it('assigns a thought to an existing project by entity id', async () => {
    assignThoughtToProjectMock.mockResolvedValue({
      projectEntityId: 'ent-1',
      projectLabel: 'Label',
      eligible: true,
      created: false,
      isGtdProject: true,
    })
    const res = await POST(event({ body: { thoughtId: 't1', projectEntityId: 'ent-1' } }))
    expect(assignThoughtToProjectMock).toHaveBeenCalledWith('u1', 't1', {
      projectEntityId: 'ent-1',
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.projectEntityId).toBe('ent-1')
  })

  it('assigns a thought to a new project by label', async () => {
    assignThoughtToProjectMock.mockResolvedValue({
      projectEntityId: 'ent-2',
      projectLabel: 'New Project',
      eligible: true,
      created: true,
      isGtdProject: true,
    })
    const res = await POST(event({ body: { thoughtId: 't1', projectLabel: 'New Project' } }))
    expect(assignThoughtToProjectMock).toHaveBeenCalledWith('u1', 't1', {
      projectLabel: 'New Project',
    })
    expect(res.status).toBe(200)
  })

  it('returns 400 when service rejects', async () => {
    assignThoughtToProjectMock.mockRejectedValue(new Error('thought not found'))
    await expect(
      POST(event({ body: { thoughtId: 't1', projectEntityId: 'ent-1' } })),
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe('DELETE /api/timeline/projects/assign (the thought leaves its thread)', () => {
  it('returns 401 when unauthenticated', async () => {
    await expect(
      DELETE({
        locals: { user: null },
        request: new Request('http://localhost', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ thoughtId: 't1' }),
        }),
      } as Parameters<typeof DELETE>[0]),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('returns 400 when thoughtId is missing', async () => {
    await expect(
      DELETE({
        locals: { user: { id: 'u1' } },
        request: new Request('http://localhost', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        }),
      } as Parameters<typeof DELETE>[0]),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('unassigns and reports the threads the thought left', async () => {
    unassignThoughtFromProjectMock.mockResolvedValue({ removedEntityIds: ['p1'] })
    const res = await DELETE({
      locals: { user: { id: 'u1' } },
      request: new Request('http://localhost', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ thoughtId: 't1' }),
      }),
    } as Parameters<typeof DELETE>[0])
    expect(unassignThoughtFromProjectMock).toHaveBeenCalledWith('u1', 't1')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.removedEntityIds).toEqual(['p1'])
  })

  it('returns 400 when service rejects', async () => {
    unassignThoughtFromProjectMock.mockRejectedValue(new Error('boom'))
    await expect(
      DELETE({
        locals: { user: { id: 'u1' } },
        request: new Request('http://localhost', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ thoughtId: 't1' }),
        }),
      } as Parameters<typeof DELETE>[0]),
    ).rejects.toMatchObject({ status: 400 })
  })
})
