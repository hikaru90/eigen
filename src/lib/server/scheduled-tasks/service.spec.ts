import { afterEach, describe, expect, it, vi } from 'vitest'

const {
  getOrCreateUserScheduledTaskMock,
  hasActiveJobForUserMock,
  loadHeartbeatRunByIdMock,
  loadActiveHeartbeatRunMock,
  runConsolidationJobForUserMock,
  replaceFinishedHeartbeatJobResultMock,
} = vi.hoisted(() => ({
  getOrCreateUserScheduledTaskMock: vi.fn(),
  hasActiveJobForUserMock: vi.fn(),
  loadHeartbeatRunByIdMock: vi.fn(),
  loadActiveHeartbeatRunMock: vi.fn(),
  runConsolidationJobForUserMock: vi.fn(),
  replaceFinishedHeartbeatJobResultMock: vi.fn(),
}))

vi.mock('$lib/server/job-queue', () => ({
  OVERNIGHT_CONSOLIDATION_JOB: 'overnight_consolidation',
  formatScheduleLabel: (hour: number, minute: number, tz: string) =>
    `Every day at ${hour}:${String(minute).padStart(2, '0')} (${tz})`,
  getOrCreateUserScheduledTask: getOrCreateUserScheduledTaskMock,
  setUserScheduledTaskPaused: vi.fn(),
}))

vi.mock('$lib/server/job-queue/enqueue', () => ({
  hasActiveJobForUser: hasActiveJobForUserMock,
}))

vi.mock('$lib/server/job-queue/recover-overnight', () => ({
  recoverOrphanedOvernightState: vi.fn(async () => undefined),
}))

vi.mock('$lib/server/consolidation/heartbeat-run-ledger', () => ({
  loadActiveHeartbeatRun: loadActiveHeartbeatRunMock,
  loadLastUserHeartbeatRun: vi.fn(async () => null),
  loadHeartbeatRunById: loadHeartbeatRunByIdMock,
  replaceFinishedHeartbeatJobResult: replaceFinishedHeartbeatJobResultMock,
  heartbeatProgressPct: vi.fn(() => 0),
  isHeartbeatRunActive: (status: string) => status === 'running',
}))

vi.mock('$lib/server/consolidation/runner', () => ({
  formatConsolidationJobSummaries: vi.fn(() => []),
  runConsolidationJobForUser: runConsolidationJobForUserMock,
}))

describe('listScheduledTasks', () => {
  afterEach(() => {
    vi.resetModules()
  })

  it('returns overnight task from Postgres schedule row', async () => {
    getOrCreateUserScheduledTaskMock.mockResolvedValue({
      userId: 'user-1',
      taskType: 'overnight_consolidation',
      runHour: 2,
      runMinute: 0,
      timezone: 'UTC',
      paused: false,
    })
    hasActiveJobForUserMock.mockResolvedValue(false)
    loadActiveHeartbeatRunMock.mockResolvedValue(null)

    const { listScheduledTasks } = await import('./service')
    const tasks = await listScheduledTasks('user-1')

    expect(tasks).toHaveLength(1)
    expect(tasks[0].title).toBe('Overnight memory heartbeat')
    expect(tasks[0].active).toBe(true)
    expect(tasks[0].configured).toBe(true)
    expect(tasks[0].queueActive).toBe(false)
    expect(tasks[0].scheduleLabel).toContain('2:00')
  })
})

describe('retryFailedHeartbeatJob', () => {
  afterEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('re-runs only a failed step and patches the finished run', async () => {
    hasActiveJobForUserMock.mockResolvedValue(false)
    loadActiveHeartbeatRunMock.mockResolvedValue(null)
    loadHeartbeatRunByIdMock.mockResolvedValue({
      runId: 'r1',
      status: 'failed',
      jobs: [
        {
          phase: 'deep_sleep',
          job: 'repair_entity_relations',
          ok: false,
          detail: 'LLM HTTP 400',
          durationMs: 10,
        },
      ],
    })
    runConsolidationJobForUserMock.mockResolvedValue({
      phase: 'deep_sleep',
      job: 'repair_entity_relations',
      ok: true,
      detail: 'repaired 2',
      durationMs: 20,
    })
    replaceFinishedHeartbeatJobResultMock.mockResolvedValue({
      runId: 'r1',
      status: 'completed',
      jobs: [
        {
          phase: 'deep_sleep',
          job: 'repair_entity_relations',
          ok: true,
          detail: 'repaired 2',
          durationMs: 20,
        },
      ],
    })

    const { retryFailedHeartbeatJob } = await import('./service')
    const result = await retryFailedHeartbeatJob('u1', {
      runId: 'r1',
      jobId: 'repair_entity_relations',
    })

    expect(runConsolidationJobForUserMock).toHaveBeenCalledWith('u1', 'repair_entity_relations')
    expect(replaceFinishedHeartbeatJobResultMock).toHaveBeenCalled()
    expect(result.job.ok).toBe(true)
    expect(result.run.status).toBe('completed')
  })

  it('rejects retry of a successful step', async () => {
    hasActiveJobForUserMock.mockResolvedValue(false)
    loadActiveHeartbeatRunMock.mockResolvedValue(null)
    loadHeartbeatRunByIdMock.mockResolvedValue({
      runId: 'r1',
      status: 'failed',
      jobs: [
        {
          phase: 'deep_sleep',
          job: 'repair_entity_relations',
          ok: true,
          detail: 'ok',
          durationMs: 10,
        },
      ],
    })

    const { retryFailedHeartbeatJob, HeartbeatJobRetryError } = await import('./service')
    await expect(
      retryFailedHeartbeatJob('u1', { runId: 'r1', jobId: 'repair_entity_relations' }),
    ).rejects.toBeInstanceOf(HeartbeatJobRetryError)
    expect(runConsolidationJobForUserMock).not.toHaveBeenCalled()
  })
})
