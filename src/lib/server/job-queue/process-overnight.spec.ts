import { beforeEach, describe, expect, it, vi } from 'vitest'

const { withDbUserMock, consolidateMock, insertMock, patchMock, readCancelMock, finishMock } =
  vi.hoisted(() => ({
    withDbUserMock: vi.fn(async (_userId: string, fn: () => Promise<unknown>) => fn()),
    consolidateMock: vi.fn(),
    insertMock: vi.fn(),
    patchMock: vi.fn(),
    readCancelMock: vi.fn(),
    finishMock: vi.fn(),
  }))

vi.mock('$lib/server/db', () => ({
  withDbUser: withDbUserMock,
}))

vi.mock('$lib/server/consolidation/runner', () => ({
  consolidateForUser: consolidateMock,
}))

vi.mock('$lib/server/consolidation/heartbeat-run-ledger', () => ({
  insertRunningHeartbeatRun: insertMock,
  patchHeartbeatRunProgress: patchMock,
  readHeartbeatRunCancelRequested: readCancelMock,
  finishHeartbeatRun: finishMock,
}))

describe('processOvernightConsolidationJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    insertMock.mockResolvedValue('run-1')
    readCancelMock.mockResolvedValue(false)
    finishMock.mockResolvedValue(undefined)
    consolidateMock.mockResolvedValue({
      userId: 'u1',
      jobs: [{ phase: 'deep_sleep', job: 'salience_compute', ok: true, durationMs: 1 }],
      totalDurationMs: 1,
    })
  })

  it('does not nest withDbUser inside consolidateForUser progress callbacks', async () => {
    const { processOvernightConsolidationJob } = await import('./process-overnight')
    let capturedOptions: {
      onJobStart?: (job: string) => Promise<void>
      shouldCancel?: () => Promise<boolean>
    } = {}

    consolidateMock.mockImplementation(async (_userId: string, options: typeof capturedOptions) => {
      capturedOptions = options
      await options.onJobStart?.('salience_compute')
      return {
        userId: 'u1',
        jobs: [],
        totalDurationMs: 0,
      }
    })

    await processOvernightConsolidationJob({
      id: 'job-1',
      userId: 'u1',
      jobType: 'overnight_consolidation',
      status: 'running',
      payload: {},
      runAfter: new Date(),
      dedupeKey: null,
      attemptCount: 1,
      maxAttempts: 3,
      lastError: null,
      heartbeatRunId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      startedAt: new Date(),
      finishedAt: null,
    })

    expect(patchMock).toHaveBeenCalled()
    const nestedDuringCallback = withDbUserMock.mock.calls.some(
      ([, fn]) => fn === capturedOptions.onJobStart,
    )
    expect(nestedDuringCallback).toBe(false)
  })
})
