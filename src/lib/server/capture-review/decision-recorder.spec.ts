import { describe, expect, it } from 'vitest'
import { recordDecision, withDecisionRecorder } from './decision-recorder'

describe('decision recorder', () => {
  it('collects the decisions recorded inside the scope, in order, and returns the result', async () => {
    const { result, decisions } = await withDecisionRecorder(async () => {
      recordDecision({ kind: 'category', ref: 'category', choice: 'task', probability: 0.9 })
      await Promise.resolve()
      recordDecision({ kind: 'entity_type', ref: 'm1', choice: 'person', probability: 0.62 })
      return 'done'
    })

    expect(result).toBe('done')
    expect(decisions).toEqual([
      { kind: 'category', ref: 'category', choice: 'task', probability: 0.9 },
      { kind: 'entity_type', ref: 'm1', choice: 'person', probability: 0.62 },
    ])
  })

  it('is a no-op outside a scope (nothing recorded, nothing thrown)', () => {
    expect(() =>
      recordDecision({ kind: 'category', ref: 'category', choice: 'task', probability: 0.9 }),
    ).not.toThrow()
  })

  it('does not leak a finished scope into the next one', async () => {
    await withDecisionRecorder(async () => {
      recordDecision({ kind: 'category', ref: 'category', choice: 'task', probability: 0.9 })
    })
    const second = await withDecisionRecorder(async () => undefined)
    expect(second.decisions).toEqual([])
  })

  it('isolates concurrent scopes from each other', async () => {
    const slow = withDecisionRecorder(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15))
      recordDecision({ kind: 'temporal_kind', ref: 't1', choice: 'deadline', probability: 0.8 })
    })
    const fast = withDecisionRecorder(async () => {
      recordDecision({ kind: 'entity_type', ref: 'm1', choice: 'place', probability: 0.7 })
      await new Promise((resolve) => setTimeout(resolve, 5))
      recordDecision({ kind: 'entity_type', ref: 'm2', choice: 'person', probability: 0.6 })
    })

    const [a, b] = await Promise.all([slow, fast])

    expect(a.decisions.map((d) => d.ref)).toEqual(['t1'])
    expect(b.decisions.map((d) => d.ref)).toEqual(['m1', 'm2'])
  })

  it('follows work started inside the scope (parallel steps such as the enrich fan-out)', async () => {
    const { decisions } = await withDecisionRecorder(async () => {
      await Promise.allSettled([
        (async () => {
          await Promise.resolve()
          recordDecision({ kind: 'entity_type', ref: 'm1', choice: 'person', probability: 0.9 })
        })(),
        (async () => {
          await new Promise((resolve) => setTimeout(resolve, 3))
          recordDecision({ kind: 'temporal_kind', ref: 't1', choice: 'deadline', probability: 0.8 })
        })(),
      ])
    })
    expect(decisions.map((d) => `${d.kind}:${d.ref}`).sort()).toEqual([
      'entity_type:m1',
      'temporal_kind:t1',
    ])
  })

  it('rethrows what the scope throws (a failed attempt yields no decisions to the caller)', async () => {
    await expect(
      withDecisionRecorder(async () => {
        recordDecision({ kind: 'category', ref: 'category', choice: 'task', probability: 0.9 })
        throw new Error('enrich failed')
      }),
    ).rejects.toThrow('enrich failed')
  })

  it('entries carry exactly kind, ref, choice and probability — no text field', async () => {
    const { decisions } = await withDecisionRecorder(async () => {
      recordDecision({ kind: 'entity_type', ref: 'm3', choice: 'person', probability: 0.55 })
    })
    expect(Object.keys(decisions[0]).sort()).toEqual(['choice', 'kind', 'probability', 'ref'])
  })

  it('rejects a malformed entry inside a scope (a bug in the caller must be loud)', async () => {
    await expect(
      withDecisionRecorder(async () => {
        recordDecision({ kind: 'category', ref: 'category', choice: 'task', probability: 1.2 })
      }),
    ).rejects.toThrow(/probability/)
    await expect(
      withDecisionRecorder(async () => {
        recordDecision({ kind: 'category', ref: '', choice: 'task', probability: 0.5 })
      }),
    ).rejects.toThrow(/ref/)
    await expect(
      withDecisionRecorder(async () => {
        recordDecision({ kind: 'category', ref: 'category', choice: ' ', probability: 0.5 })
      }),
    ).rejects.toThrow(/choice/)
  })
})
