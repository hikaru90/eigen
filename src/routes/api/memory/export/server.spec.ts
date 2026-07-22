import { describe, expect, it, vi, beforeEach } from 'vitest'
import { GET } from './+server'

const { buildMemoryExportZipMock } = vi.hoisted(() => ({
  buildMemoryExportZipMock: vi.fn(),
}))

vi.mock('$lib/server/export/memory-export', () => ({
  buildMemoryExportZip: buildMemoryExportZipMock,
}))

beforeEach(() => {
  buildMemoryExportZipMock.mockReset()
})

describe('GET /api/memory/export', () => {
  it('returns 401 for unauthenticated requests', async () => {
    await expect(GET({ locals: { user: null } } as never)).rejects.toMatchObject({
      status: 401,
    })
  })

  it('returns ZIP with attachment disposition', async () => {
    buildMemoryExportZipMock.mockResolvedValue({
      filename: 'eigen-memory-export-2026-06-06.zip',
      bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      manifest: { exportVersion: 1, userId: 'u1', exportedAt: '', files: {} },
    })

    const res = await GET({ locals: { user: { id: 'u1' } } } as never)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/zip')
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="eigen-memory-export-2026-06-06.zip"',
    )

    const body = new Uint8Array(await res.arrayBuffer())
    expect(body).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))
    expect(buildMemoryExportZipMock).toHaveBeenCalledWith('u1')
  })
})
