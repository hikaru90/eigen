import { describe, expect, it, vi, beforeEach } from 'vitest'
import { SLEEP_CONSOLIDATION_TASK_ID } from '$lib/server/scheduled-tasks/constants'
import { HeartbeatJobRetryError } from '$lib/server/scheduled-tasks/service'
import { POST } from './+server'

const { retryFailedHeartbeatJobMock } = vi.hoisted(() => ({
  retryFailedHeartbeatJobMock: vi.fn(),
}))

vi.mock('$lib/server/scheduled-tasks/service', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/scheduled-tasks/service')>(
    '$lib/server/scheduled-tasks/service',
  )
  return {
    ...actual,
    retryFailedHeartbeatJob: retryFailedHeartbeatJobMock,
  }
})

function postRequest(body: unknown) {
  return new Request('http://localhost/api/scheduled-tasks/task/retry', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/scheduled-tasks/[taskId]/retry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    await expect(
      POST({
        locals: { user: null },
        params: { taskId: SLEEP_CONSOLIDATION_TASK_ID },
        request: postRequest({ runId: 'r1', jobId: 'repair_entity_relations' }),
      } as never),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('retries a failed job and returns the updated result', async () => {
    retryFailedHeartbeatJobMock.mockResolvedValue({
      run: { runId: 'r1', status: 'completed' },
      job: {
        phase: 'deep_sleep',
        job: 'repair_entity_relations',
        ok: true,
        detail: 'repaired 3',
        durationMs: 12,
      },
    })

    const res = await POST({
      locals: { user: { id: 'u1' } },
      params: { taskId: SLEEP_CONSOLIDATION_TASK_ID },
      request: postRequest({ runId: 'r1', jobId: 'repair_entity_relations' }),
    } as never)

    expect(retryFailedHeartbeatJobMock).toHaveBeenCalledWith('u1', {
      runId: 'r1',
      jobId: 'repair_entity_relations',
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true,
      runId: 'r1',
      status: 'completed',
      message: 'Retried repair_entity_relations successfully.',
    })
  })

  it('maps HeartbeatJobRetryError to the declared status', async () => {
    retryFailedHeartbeatJobMock.mockRejectedValue(
      new HeartbeatJobRetryError('Only failed steps can be retried.', 400),
    )

    const res = await POST({
      locals: { user: { id: 'u1' } },
      params: { taskId: SLEEP_CONSOLIDATION_TASK_ID },
      request: postRequest({ runId: 'r1', jobId: 'repair_entity_relations' }),
    } as never)

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      ok: false,
      error: 'Only failed steps can be retried.',
    })
  })
})
