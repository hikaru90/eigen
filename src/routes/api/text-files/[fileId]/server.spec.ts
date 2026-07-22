import { describe, expect, it, vi } from 'vitest'
import { DELETE, GET, PATCH } from './+server'

const { deleteTextFileMock, getTextFileMock, updateTextFileMock } = vi.hoisted(() => ({
  deleteTextFileMock: vi.fn(),
  getTextFileMock: vi.fn(),
  updateTextFileMock: vi.fn(),
}))

vi.mock('$lib/server/text-files/service', () => ({
  deleteTextFile: deleteTextFileMock,
  getTextFile: getTextFileMock,
  updateTextFile: updateTextFileMock,
}))

function getEvent(overrides: { user?: { id: string } | null; fileId?: string } = {}) {
  return {
    locals: { user: overrides.user === undefined ? { id: 'u1' } : overrides.user },
    params: { fileId: overrides.fileId ?? 'file-1' },
  } as Parameters<typeof GET>[0]
}

function patchEvent(
  overrides: { user?: { id: string } | null; fileId?: string; body?: unknown } = {},
) {
  return {
    locals: { user: overrides.user === undefined ? { id: 'u1' } : overrides.user },
    params: { fileId: overrides.fileId ?? 'file-1' },
    request: new Request('http://localhost/api/text-files/file-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(overrides.body ?? {}),
    }),
  } as Parameters<typeof PATCH>[0]
}

describe('GET /api/text-files/[fileId]', () => {
  it('returns 401 when unauthenticated', async () => {
    await expect(GET(getEvent({ user: null }))).rejects.toMatchObject({ status: 401 })
  })

  it('returns 400 when fileId is missing', async () => {
    await expect(GET(getEvent({ fileId: ' ' }))).rejects.toMatchObject({ status: 400 })
  })

  it('returns 404 when text file is not found', async () => {
    getTextFileMock.mockResolvedValue(null)
    await expect(GET(getEvent())).rejects.toMatchObject({ status: 404 })
  })

  it('returns the text file', async () => {
    getTextFileMock.mockResolvedValue({ id: 'file-1', title: 'Notes' })
    const res = await GET(getEvent())
    expect(getTextFileMock).toHaveBeenCalledWith('u1', 'file-1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ textFile: { id: 'file-1', title: 'Notes' } })
  })
})

describe('PATCH /api/text-files/[fileId]', () => {
  it('returns 401 when unauthenticated', async () => {
    await expect(PATCH(patchEvent({ user: null }))).rejects.toMatchObject({ status: 401 })
  })

  it('returns 400 for invalid JSON body', async () => {
    await expect(
      PATCH({
        locals: { user: { id: 'u1' } },
        params: { fileId: 'file-1' },
        request: new Request('http://localhost', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: 'not-json',
        }),
      } as Parameters<typeof PATCH>[0]),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('returns 400 when neither title nor body is provided', async () => {
    await expect(PATCH(patchEvent({ body: {} }))).rejects.toMatchObject({ status: 400 })
  })

  it('returns 404 when the text file is not found', async () => {
    updateTextFileMock.mockResolvedValue(null)
    await expect(PATCH(patchEvent({ body: { title: 'New title' } }))).rejects.toMatchObject({
      status: 404,
    })
  })

  it('updates and returns the text file', async () => {
    updateTextFileMock.mockResolvedValue({ id: 'file-1', title: 'New title' })
    const res = await PATCH(patchEvent({ body: { title: 'New title' } }))
    expect(updateTextFileMock).toHaveBeenCalledWith('u1', 'file-1', {
      title: 'New title',
      body: undefined,
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ textFile: { id: 'file-1', title: 'New title' } })
  })

  it('returns 400 when update fails', async () => {
    updateTextFileMock.mockRejectedValue(new Error('too long'))
    await expect(PATCH(patchEvent({ body: { body: 'x'.repeat(10) } }))).rejects.toMatchObject({
      status: 400,
    })
  })
})

describe('DELETE /api/text-files/[fileId]', () => {
  it('returns 401 when unauthenticated', async () => {
    await expect(DELETE(getEvent({ user: null }))).rejects.toMatchObject({ status: 401 })
  })

  it('returns 400 when fileId is missing', async () => {
    await expect(DELETE(getEvent({ fileId: ' ' }))).rejects.toMatchObject({ status: 400 })
  })

  it('returns 404 when text file is not found', async () => {
    deleteTextFileMock.mockResolvedValue(false)
    await expect(DELETE(getEvent())).rejects.toMatchObject({ status: 404 })
  })

  it('deletes the text file', async () => {
    deleteTextFileMock.mockResolvedValue(true)
    const res = await DELETE(getEvent())
    expect(deleteTextFileMock).toHaveBeenCalledWith('u1', 'file-1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deleted: true, textFileId: 'file-1' })
  })
})
