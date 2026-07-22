import { describe, expect, it } from 'vitest'
import { HEARTBEAT_JOB_PLAN, getHeartbeatJobPlan } from './heartbeat-job-plan'
import {
  heartbeatProgressPctFromRun,
  isHeartbeatRunFullyComplete,
  type HeartbeatJobResult,
} from './heartbeat-progress'

function okJob(job: string, detail?: string): HeartbeatJobResult {
  return { job, ok: true, detail }
}

describe('getHeartbeatJobPlan', () => {
  it('includes all consolidation runner jobs in order', () => {
    expect(getHeartbeatJobPlan()).toEqual([
      'salience_compute',
      'ontology_prune',
      'repair_canonical_entity_types',
      'dedup_canonical_entities',
      'repair_entity_relations',
      'community_detection',
      'community_summaries',
      'community_bundles',
      'retrieval_links_backfill',
      'thought_retrieval_features',
    ])
    expect(getHeartbeatJobPlan()).toHaveLength(HEARTBEAT_JOB_PLAN.length)
  })
})

describe('isHeartbeatRunFullyComplete', () => {
  const plannedJobs = getHeartbeatJobPlan()

  it('returns true when every planned job succeeded', () => {
    expect(
      isHeartbeatRunFullyComplete({
        plannedJobs,
        jobs: plannedJobs.map((job) => okJob(job)),
        currentJob: null,
      }),
    ).toBe(true)
  })

  it('returns false when extra jobs exist beyond the plan (legacy runs)', () => {
    expect(
      isHeartbeatRunFullyComplete({
        plannedJobs: plannedJobs.slice(0, 7),
        jobs: plannedJobs.map((job) => okJob(job)),
        currentJob: null,
      }),
    ).toBe(true)
  })

  it('returns false when a planned job is missing or failed', () => {
    const jobs = plannedJobs.slice(0, -1).map((job) => okJob(job))
    expect(
      isHeartbeatRunFullyComplete({
        plannedJobs,
        jobs,
        currentJob: null,
      }),
    ).toBe(false)

    const withFailure = plannedJobs.map((job) =>
      job === 'ontology_prune' ? { job, ok: false, detail: 'prune failed' } : okJob(job),
    )
    expect(
      isHeartbeatRunFullyComplete({
        plannedJobs,
        jobs: withFailure,
        currentJob: null,
      }),
    ).toBe(false)
  })

  it('returns false when community summaries still have pending work', () => {
    expect(
      isHeartbeatRunFullyComplete({
        plannedJobs,
        jobs: plannedJobs.map((job) =>
          job === 'community_summaries'
            ? okJob(job, '20 of 24 L1 routing summaries, 20 new, 4 pending')
            : okJob(job),
        ),
        currentJob: null,
      }),
    ).toBe(false)
  })

  it('returns true when remaining summaries are deferred for the next run', () => {
    expect(
      isHeartbeatRunFullyComplete({
        plannedJobs,
        jobs: plannedJobs.map((job) =>
          job === 'community_summaries'
            ? okJob(
                job,
                '20 of 24 L1 routing summaries, 20 new, 4 pending, 4 deferred — will resume next run',
              )
            : okJob(job),
        ),
        currentJob: null,
      }),
    ).toBe(true)
  })
})

describe('heartbeatProgressPctFromRun', () => {
  const plannedJobs = getHeartbeatJobPlan()

  it('reports 100% when all planned jobs completed', () => {
    expect(
      heartbeatProgressPctFromRun(
        {
          plannedJobs,
          jobs: plannedJobs.map((job) => okJob(job)),
          currentJob: null,
        },
        null,
        { capIncompleteAt99: true },
      ),
    ).toBe(100)
  })

  it('does not cap at 99% when extra jobs exist beyond a short plan (legacy bug)', () => {
    const legacyPlan = plannedJobs.slice(0, 7)
    const allJobs = plannedJobs.map((job) => okJob(job))
    expect(
      heartbeatProgressPctFromRun(
        {
          plannedJobs: legacyPlan,
          jobs: allJobs,
          currentJob: null,
        },
        null,
        { capIncompleteAt99: true },
      ),
    ).toBe(100)
  })

  it('caps incomplete runs at 99% on the client', () => {
    const jobs = plannedJobs.slice(0, 5).map((job) => okJob(job))
    expect(
      heartbeatProgressPctFromRun(
        {
          plannedJobs,
          jobs,
          currentJob: null,
        },
        null,
        { capIncompleteAt99: true },
      ),
    ).toBe(50)
    expect(
      heartbeatProgressPctFromRun(
        {
          plannedJobs,
          jobs: plannedJobs.slice(0, -1).map((job) => okJob(job)),
          currentJob: 'thought_retrieval_features',
        },
        null,
        { capIncompleteAt99: true },
      ),
    ).toBe(95)
  })

  it('uses fractional progress while community summaries are running', () => {
    const prior = plannedJobs.slice(0, 7).map((job) => okJob(job))
    expect(
      heartbeatProgressPctFromRun(
        {
          plannedJobs,
          jobs: prior,
          currentJob: 'community_summaries',
        },
        { summarized: 15, total: 30 },
        { capIncompleteAt99: true },
      ),
    ).toBe(65)
  })
})
