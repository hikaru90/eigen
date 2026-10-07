import { describe, expect, it } from 'vitest'
import { computeStalledSignal } from './project-list'

const BASE = {
  status: 'active' as const,
  targetDate: null,
  milestones: [],
  nextAction: { thoughtId: 't1', summary: 'x', itemId: 'task:t1' },
  openTaskCount: 3,
}

describe('computeStalledSignal', () => {
  it('null for non-active projects regardless of inputs', () => {
    const now = new Date('2026-10-06T12:00:00Z')
    expect(
      computeStalledSignal({
        ...BASE,
        status: 'someday',
        targetDate: '2026-01-01T00:00:00Z',
        now,
      }),
    ).toBeNull()
  })

  it('deadline_overdue when the project target date is in the past', () => {
    const now = new Date('2026-10-06T12:00:00Z')
    expect(
      computeStalledSignal({ ...BASE, targetDate: '2026-09-01T00:00:00Z', now }),
    ).toEqual({ reason: 'deadline_overdue' })
  })

  it('milestone_overdue when an open milestone is past due (even with healthy deadline)', () => {
    const now = new Date('2026-10-06T12:00:00Z')
    expect(
      computeStalledSignal({
        ...BASE,
        targetDate: '2027-01-01T00:00:00Z',
        milestones: [
          { targetDate: '2026-09-01T00:00:00Z', completedAt: null },
          { targetDate: '2026-05-01T00:00:00Z', completedAt: '2026-05-02T00:00:00Z' },
        ],
        now,
      }),
    ).toEqual({ reason: 'milestone_overdue' })
  })

  it('no_next_action when there are open tasks but no designated next action', () => {
    const now = new Date('2026-10-06T12:00:00Z')
    expect(
      computeStalledSignal({ ...BASE, nextAction: null, now }),
    ).toEqual({ reason: 'no_next_action' })
  })

  it('null when everything is healthy', () => {
    const now = new Date('2026-10-06T12:00:00Z')
    expect(
      computeStalledSignal({
        status: 'active',
        targetDate: '2027-01-01T00:00:00Z',
        milestones: [{ targetDate: '2026-12-01T00:00:00Z', completedAt: null }],
        nextAction: { thoughtId: 't1', summary: 'x', itemId: 'task:t1' },
        openTaskCount: 2,
        now,
      }),
    ).toBeNull()
  })

  it('null when openTaskCount is zero even without a next action', () => {
    const now = new Date('2026-10-06T12:00:00Z')
    expect(
      computeStalledSignal({ ...BASE, nextAction: null, openTaskCount: 0, now }),
    ).toBeNull()
  })
})
