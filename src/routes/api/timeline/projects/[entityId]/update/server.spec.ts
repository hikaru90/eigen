import { describe, expect, it, vi } from 'vitest'
import { PUT } from './+server'

const { updateProjectLabelMock } = vi.hoisted(() => ({
  updateProjectLabelMock: vi.fn(),
}))

vi.mock('$lib/server/memory/project-list', () => ({
  updateProjectLabel: updateProjectLabelMock,
}))

function event(
  overrides: { user?: { id: string } | null; entityId?: string; body?: unknown } = {},
) {
  return {
    locals: { user: overrides.user === undefined ? { id: 'u1' } : overrides.user },
    params: { entityId: overrides.entityId ?? 'ent-1' },
    request: new Request('http://localhost/api/timeline/projects/ent-1/update', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(overrides.body ?? {}),
    }),
  } as Parameters<typeof PUT>[0]
}

describe('PUT /api/timeline/projects/[entityId]/update', () => {
  it('returns 401 when unauthenticated', async () => {
    await expect(PUT(event({ user: null }))).rejects.toMatchObject({ status: 401 })
  })

  it('returns 400 when entityId is missing', async () => {
    await expect(PUT(event({ entityId: ' ' }))).rejects.toMatchObject({ status: 400 })
  })

  it('returns 400 for invalid JSON body', async () => {
    await expect(
      PUT({
        locals: { user: { id: 'u1' } },
        params: { entityId: 'ent-1' },
        request: new Request('http://localhost', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: 'not-json',
        }),
      } as Parameters<typeof PUT>[0]),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('returns 400 when label is empty', async () => {
    await expect(PUT(event({ body: { label: '  ' } }))).rejects.toMatchObject({ status: 400 })
  })

  it('updates the project label', async () => {
    updateProjectLabelMock.mockResolvedValue({ entityId: 'ent-1', label: 'New Label' })
    const res = await PUT(event({ body: { label: 'New Label' } }))
    expect(updateProjectLabelMock).toHaveBeenCalledWith('u1', 'ent-1', 'New Label')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ entityId: 'ent-1', label: 'New Label' })
  })

  it('returns 400 when service rejects', async () => {
    updateProjectLabelMock.mockRejectedValue(new Error('not found'))
    await expect(PUT(event({ body: { label: 'x' } }))).rejects.toMatchObject({ status: 400 })
  })
})
