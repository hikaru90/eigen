import { describe, expect, it } from 'vitest'
import {
  buildProjectGanttRange,
  placeGanttBar,
  placeGanttMarker,
  type ProjectGanttTask,
} from './project-gantt-utils'

describe('buildProjectGanttRange', () => {
  it('uses task starts/ends, milestones, and deadline', () => {
    const tasks: ProjectGanttTask[] = [
      { id: 't1', startAt: '2026-08-01T00:00:00.000Z', endAt: '2026-08-05T00:00:00.000Z' },
      { id: 't2', startAt: null, endAt: null },
    ]
    const range = buildProjectGanttRange({
      tasks,
      milestones: [{ targetDate: '2026-09-01T00:00:00.000Z' }],
      deadline: '2026-10-01T00:00:00.000Z',
      now: new Date('2026-07-01T00:00:00.000Z'),
    })
    expect(range.startMs).toBe(Date.parse('2026-08-01T00:00:00.000Z'))
    expect(range.endMs).toBe(Date.parse('2026-10-01T00:00:00.000Z'))
  })

  it('falls back to a 14-day window from now when nothing is dated', () => {
    const now = new Date('2026-07-01T00:00:00.000Z')
    const range = buildProjectGanttRange({
      tasks: [{ id: 't1', startAt: null, endAt: null }],
      milestones: [],
      deadline: null,
      now,
    })
    expect(range.startMs).toBe(now.getTime())
    expect(range.endMs).toBe(now.getTime() + 14 * 24 * 60 * 60 * 1000)
  })
})

describe('placeGanttBar', () => {
  const range = {
    startMs: Date.parse('2026-08-01T00:00:00.000Z'),
    endMs: Date.parse('2026-08-11T00:00:00.000Z'),
  }

  it('returns null for undated tasks', () => {
    expect(placeGanttBar({ startAt: null, endAt: null }, range)).toBeNull()
  })

  it('maps start/end to percent offset and width', () => {
    const bar = placeGanttBar(
      {
        startAt: '2026-08-03T00:00:00.000Z',
        endAt: '2026-08-05T00:00:00.000Z',
      },
      range,
    )
    expect(bar).not.toBeNull()
    expect(bar!.leftPct).toBeCloseTo(20, 5)
    expect(bar!.widthPct).toBeCloseTo(20, 5)
  })

  it('uses a one-day default width when only startAt is set', () => {
    const bar = placeGanttBar({ startAt: '2026-08-01T00:00:00.000Z', endAt: null }, range)
    expect(bar).not.toBeNull()
    expect(bar!.leftPct).toBeCloseTo(0, 5)
    expect(bar!.widthPct).toBeCloseTo(10, 5)
  })
})

describe('placeGanttMarker', () => {
  const range = {
    startMs: Date.parse('2026-08-01T00:00:00.000Z'),
    endMs: Date.parse('2026-08-11T00:00:00.000Z'),
  }

  it('places a marker at the date percent', () => {
    expect(placeGanttMarker('2026-08-06T00:00:00.000Z', range)).toBeCloseTo(50, 5)
  })

  it('returns null for invalid or out-of-range dates', () => {
    expect(placeGanttMarker(null, range)).toBeNull()
    expect(placeGanttMarker('not-a-date', range)).toBeNull()
  })
})
