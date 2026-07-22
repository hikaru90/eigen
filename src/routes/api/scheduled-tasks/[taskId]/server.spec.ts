import { describe, expect, it, vi, beforeEach } from 'vitest'
import { DELETE, PATCH, POST } from './+server'
import { SLEEP_CONSOLIDATION_TASK_ID } from '$lib/server/scheduled-tasks/constants'

const {
  setUserScheduledTaskPausedMock,
  enqueueUserJobMock,
  hasActiveJobForUserMock,
  drainUserJobQueueMock,
  loadActiveHeartbeatRunMock,
  recoverOrphanedOvernightStateMock,
  stopOvernightHeartbeatMock,
} = vi.hoisted(() => ({
  setUserScheduledTaskPausedMock: vi.fn(),
  enqueueUserJobMock: vi.fn(),
  hasActiveJobForUserMock: vi.fn(),
  drainUserJobQueueMock: vi.fn(),
  loadActiveHeartbeatRunMock: vi.fn(),
  recoverOrphanedOvernightStateMock: vi.fn(async () => undefined),
  stopOvernightHeartbeatMock: vi.fn(),
}))

vi.mock('$lib/server/scheduled-tasks/service', () => ({
  setUserScheduledTaskPaused: setUserScheduledTaskPausedMock,
}))

vi.mock('$lib/server/job-queue', () => ({
  OVERNIGHT_CONSOLIDATION_JOB: 'overnight_consolidation',
  enqueueUserJob: enqueueUserJobMock,
  hasActiveJobForUser: hasActiveJobForUserMock,
  drainUserJobQueue: drainUserJobQueueMock,
}))

vi.mock('$lib/server/consolidation/heartbeat-run-ledger', () => ({
  loadActiveHeartbeatRun: loadActiveHeartbeatRunMock,
}))

vi.mock('$lib/consolidation/heartbeat-job-plan', () => ({
  getHeartbeatJobPlan: vi.fn(() => ['salience_compute', 'community_detection']),
}))

vi.mock('$lib/server/job-queue/recover-overnight', () => ({
  recoverOrphanedOvernightState: recoverOrphanedOvernightStateMock,
  stopOvernightHeartbeat: stopOvernightHeartbeatMock,
}))

function patchRequest(body: unknown) {
  return new Request('http://localhost/api/scheduled-tasks/task', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PATCH /api/scheduled-tasks/[taskId]', () => {
  it('returns 401 when unauthenticated', async () => {
    await expect(
      PATCH({
        locals: { user: null },
        params: { taskId: 'task-1' },
        request: patchRequest({ paused: true }),
      } as never),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('toggles pause state on success', async () => {
    setUserScheduledTaskPausedMock.mockResolvedValue(undefined)

    const res = await PATCH({
      locals: { user: { id: 'u1' } },
      params: { taskId: 'task-1' },
      request: patchRequest({ paused: true }),
    } as never)

    expect(setUserScheduledTaskPausedMock).toHaveBeenCalledWith('u1', 'task-1', true)
    expect(await res.json()).toEqual({ ok: true, paused: true })
  })
})

describe('POST /api/scheduled-tasks/[taskId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    recoverOrphanedOvernightStateMock.mockResolvedValue(undefined)
  })

  it('returns 409 when heartbeat is already running', async () => {
    hasActiveJobForUserMock.mockResolvedValue(true)
    loadActiveHeartbeatRunMock.mockResolvedValue({ runId: 'run-1' })

    const res = await POST({
      locals: { user: { id: 'u1' } },
      params: { taskId: SLEEP_CONSOLIDATION_TASK_ID },
    } as never)

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      ok: false,
      runId: 'run-1',
      status: 'running',
    })
  })

  it('queues heartbeat, drains in background, and returns 202 immediately', async () => {
    hasActiveJobForUserMock.mockResolvedValue(false)
    enqueueUserJobMock.mockResolvedValue({ enqueued: true, jobId: 'job-1' })
    drainUserJobQueueMock.mockResolvedValue({ claimed: 1, completed: 1, failed: 0 })

    const res = await POST({
      locals: { user: { id: 'u1' } },
      params: { taskId: SLEEP_CONSOLIDATION_TASK_ID },
    } as never)

    expect(res.status).toBe(202)
    expect(recoverOrphanedOvernightStateMock).toHaveBeenCalledWith('u1')
    expect(await res.json()).toMatchObject({
      ok: true,
      jobId: 'job-1',
      status: 'queued',
      message: 'Heartbeat started.',
    })
    // Drain is fire-and-forget — allow microtask flush.
    await Promise.resolve()
    expect(drainUserJobQueueMock).toHaveBeenCalledWith({ userId: 'u1', limit: 1 })
  })
})

describe('DELETE /api/scheduled-tasks/[taskId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stops a live heartbeat via soft cancel', async () => {
    stopOvernightHeartbeatMock.mockResolvedValue({
      softCancelled: true,
      clearedStuck: false,
      message: 'Stop requested — finishing current step, then you can run again.',
    })

    const res = await DELETE({
      locals: { user: { id: 'u1' } },
      params: { taskId: SLEEP_CONSOLIDATION_TASK_ID },
    } as never)

    expect(stopOvernightHeartbeatMock).toHaveBeenCalledWith('u1')
    expect(await res.json()).toEqual({
      ok: true,
      softCancelled: true,
      clearedStuck: false,
      message: 'Stop requested — finishing current step, then you can run again.',
    })
  })

  it('clears stuck/orphaned state so Run now works again', async () => {
    stopOvernightHeartbeatMock.mockResolvedValue({
      softCancelled: false,
      clearedStuck: true,
      message: 'Heartbeat stopped. You can run again.',
    })

    const res = await DELETE({
      locals: { user: { id: 'u1' } },
      params: { taskId: SLEEP_CONSOLIDATION_TASK_ID },
    } as never)

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true,
      clearedStuck: true,
    })
  })
})
