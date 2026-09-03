import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listEvalRunsMock, loadEvalRunDetailMock, listEvalQaMock, loadVersionEvalOverviewMock } =
  vi.hoisted(() => ({
    listEvalRunsMock: vi.fn(),
    loadEvalRunDetailMock: vi.fn(),
    listEvalQaMock: vi.fn(),
    loadVersionEvalOverviewMock: vi.fn(),
  }))

vi.mock('$lib/eval/store', () => ({
  listEvalRuns: listEvalRunsMock,
  loadEvalRunDetail: loadEvalRunDetailMock,
}))
vi.mock('$lib/eval/qa-store', () => ({
  listEvalQa: listEvalQaMock,
}))
vi.mock('$lib/eval/version-overview', () => ({
  loadVersionEvalOverview: loadVersionEvalOverviewMock,
}))

import { load } from './+page.server'

describe('eval page server load', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listEvalRunsMock.mockResolvedValue([])
    loadEvalRunDetailMock.mockResolvedValue(null)
    listEvalQaMock.mockResolvedValue([])
    loadVersionEvalOverviewMock.mockResolvedValue({ version: '0.0.0', tests: [] })
  })

  it('redirects unauthenticated users to login', async () => {
    await expect(
      load({
        locals: { user: null },
        url: new URL('http://localhost/eval'),
      } as never),
    ).rejects.toMatchObject({ status: 302, location: '/login' })
  })

  it('returns empty eval shape without throwing when authenticated', async () => {
    const user = { id: 'u1', email: 'a@b.c' }
    const result = await load({
      locals: { user },
      url: new URL('http://localhost/eval'),
    } as never)

    expect(result.user).toEqual(user)
    expect(result.qaItems).toEqual([])
    expect(result.versionOverview).toEqual({ version: '0.0.0', tests: [] })
    expect(result.runs).toEqual([])
    expect(result.selectedRunId).toBeNull()
    expect(result.run).toBeNull()
    expect(result.entries).toEqual([])
    expect(listEvalRunsMock).toHaveBeenCalledWith('u1')
    expect(loadEvalRunDetailMock).not.toHaveBeenCalled()
    expect(listEvalQaMock).toHaveBeenCalled()
    expect(loadVersionEvalOverviewMock).toHaveBeenCalledWith('u1')
  })
})
