import { beforeEach, describe, expect, it, vi } from 'vitest'
import { scheduleProjectMaintenance } from './project-maintenance'

const { withDbUserMock, countMock, reconcileMock, auditMock } = vi.hoisted(() => ({
  withDbUserMock: vi.fn(),
  countMock: vi.fn(),
  reconcileMock: vi.fn(),
  auditMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({
  withDbUser: withDbUserMock,
}))

vi.mock('$lib/server/memory/project-eligibility', () => ({
  countGtdProjectsForUser: countMock,
}))

vi.mock('$lib/server/memory/reconcile-user-projects', () => ({
  reconcileUserProjects: reconcileMock,
}))

vi.mock('$lib/server/memory/judge-gtd-project', () => ({
  auditGtdProjectProfiles: auditMock,
}))

describe('scheduleProjectMaintenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    withDbUserMock.mockImplementation(async (_userId: string, fn: () => Promise<void>) => {
      await fn()
    })
    countMock.mockResolvedValue(1)
    reconcileMock.mockResolvedValue(undefined)
    auditMock.mockResolvedValue(undefined)
  })

  it('audits without reconcile when project count is below 2', async () => {
    countMock.mockResolvedValue(1)
    scheduleProjectMaintenance('u1')
    await vi.waitFor(() => expect(auditMock).toHaveBeenCalledWith('u1'))
    expect(reconcileMock).not.toHaveBeenCalled()
  })

  it('reconciles then audits when project count is at least 2', async () => {
    countMock.mockResolvedValue(2)
    scheduleProjectMaintenance('u1')
    await vi.waitFor(() => expect(auditMock).toHaveBeenCalledWith('u1'))
    expect(reconcileMock).toHaveBeenCalledWith('u1')
  })

  it('logs failures from background work', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    withDbUserMock.mockRejectedValue(new Error('db down'))
    scheduleProjectMaintenance('u1')
    await vi.waitFor(() => expect(errSpy).toHaveBeenCalled())
    expect(errSpy).toHaveBeenCalledWith(
      '[project-maintenance] background maintenance failed',
      expect.objectContaining({ userId: 'u1', message: 'db down' }),
    )
    errSpy.mockRestore()
  })
})
