import { describe, expect, it } from 'vitest'
import { buildReconcilePrompt, parseReconcilePayload } from './reconcile-user-projects'

describe('reconcile-user-projects', () => {
  it('buildReconcilePrompt includes graph context and stay-separate policy', () => {
    const prompt = buildReconcilePrompt(
      [
        {
          entityId: 'p1',
          label: 'Kitchen remodel',
          openTaskCount: 2,
          linkedThoughtSummaries: ['Pick tile samples'],
        },
        {
          entityId: 'p2',
          label: 'Bathroom remodel',
          openTaskCount: 1,
          linkedThoughtSummaries: ['Call plumber'],
        },
      ],
      {
        hubCandidates: [
          {
            entityId: 'h1',
            label: 'contractor',
            entityType: 'person',
            mentionCount: 3,
            linkedThoughtSummaries: ['Meet contractor Tuesday'],
          },
        ],
        graphNeighborPairs: [
          { sourceLabel: 'Kitchen remodel', targetLabel: 'contractor', predicate: 'uses' },
        ],
      },
    )
    expect(prompt).toContain('Kitchen remodel')
    expect(prompt).toContain('Bathroom remodel')
    expect(prompt).toContain('Do NOT merge related but distinct bodies of work')
    expect(prompt).toContain('Kitchen remodel --uses--> contractor')
  })

  it('parseReconcilePayload skips groups without losers', () => {
    const parsed = parseReconcilePayload(
      {
        mergeGroups: [{ winnerEntityId: 'w', loserEntityIds: [], canonicalLabel: 'X' }],
      },
      new Set(['w']),
    )
    expect(parsed.mergeGroups).toHaveLength(0)
  })

  it('parseReconcilePayload ignores grounding demote ids not in allowed set', () => {
    const parsed = parseReconcilePayload({ demoteEntityIds: ['nope'] }, new Set(['a']))
    expect(parsed.demoteEntityIds).toEqual([])
  })

  it('parseReconcilePayload never merges a manual project as loser (drops it, keeps capture losers)', () => {
    const parsed = parseReconcilePayload(
      {
        mergeGroups: [
          {
            winnerEntityId: 'manual-1',
            loserEntityIds: ['manual-1', 'capture-1', 'capture-2'],
            canonicalLabel: 'Eigenmesh',
          },
        ],
      },
      new Set(['manual-1', 'capture-1', 'capture-2']),
      new Set(['manual-1']),
    )
    expect(parsed.mergeGroups).toHaveLength(1)
    expect(parsed.mergeGroups[0].winnerEntityId).toBe('manual-1')
    expect(parsed.mergeGroups[0].loserEntityIds).toEqual(['capture-1', 'capture-2'])
  })

  it('parseReconcilePayload never auto-demotes a manual project', () => {
    const parsed = parseReconcilePayload(
      { demoteEntityIds: ['manual-1', 'capture-1'] },
      new Set(['manual-1', 'capture-1']),
      new Set(['manual-1']),
    )
    expect(parsed.demoteEntityIds).toEqual(['capture-1'])
  })

  it('buildReconcilePrompt marks manual projects and states the winner-only rule', () => {
    const prompt = buildReconcilePrompt([
      {
        entityId: 'm1',
        label: 'Eigenmesh',
        source: 'manual',
        openTaskCount: 4,
        linkedThoughtSummaries: ['Ship beta'],
      },
      {
        entityId: 'c1',
        label: 'Eigenmesh UG',
        source: 'capture',
        openTaskCount: 2,
        linkedThoughtSummaries: ['File trademark'],
      },
    ])
    expect(prompt).toContain('[manual]')
    expect(prompt).toContain('must NEVER be listed as losers and NEVER demoted')
  })
})
