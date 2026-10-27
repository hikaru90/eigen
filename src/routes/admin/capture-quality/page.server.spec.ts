import { beforeEach, describe, expect, it, vi } from 'vitest'

const { loadCaptureQualityMock } = vi.hoisted(() => ({ loadCaptureQualityMock: vi.fn() }))

vi.mock('$lib/server/capture-review/admin-quality', () => ({
  loadCaptureQuality: loadCaptureQualityMock,
}))

import { load } from './+page.server'

const quality = { totals: { reviews: 3 } }

describe('admin/capture-quality page server load', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadCaptureQualityMock.mockResolvedValue(quality)
  })

  it('defaults to production only and passes the result through', async () => {
    const result = await load({ url: new URL('http://localhost/admin/capture-quality') } as never)
    expect(loadCaptureQualityMock).toHaveBeenCalledWith({ includeHarness: false })
    expect(result).toEqual({ quality, includeHarness: false })
  })

  it('parses ?harness=1', async () => {
    const result = await load({
      url: new URL('http://localhost/admin/capture-quality?harness=1'),
    } as never)
    expect(loadCaptureQualityMock).toHaveBeenCalledWith({ includeHarness: true })
    expect(result).toEqual({ quality, includeHarness: true })
  })

  it('treats any other harness value as off', async () => {
    await load({ url: new URL('http://localhost/admin/capture-quality?harness=true') } as never)
    expect(loadCaptureQualityMock).toHaveBeenCalledWith({ includeHarness: false })
  })

  it('lets a loader failure through', async () => {
    loadCaptureQualityMock.mockRejectedValue(new Error('shape'))
    await expect(
      load({ url: new URL('http://localhost/admin/capture-quality') } as never),
    ).rejects.toThrow('shape')
  })
})
