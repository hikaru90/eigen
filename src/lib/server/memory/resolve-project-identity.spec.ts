import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getDbMock,
  llmMock,
  loadProjectsMock,
  upsertHubMock,
  promoteTypeMock,
  fetchEdgesMock,
  upsertEntityNodeMock,
  decryptMock,
  resolveEnforceKindsMock,
  runEnforcedBoundedDecisionsMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  llmMock: vi.fn(),
  loadProjectsMock: vi.fn(),
  upsertHubMock: vi.fn(),
  promoteTypeMock: vi.fn(),
  fetchEdgesMock: vi.fn(),
  upsertEntityNodeMock: vi.fn(),
  decryptMock: vi.fn(),
  resolveEnforceKindsMock: vi.fn(),
  runEnforcedBoundedDecisionsMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }))
vi.mock('$lib/server/llm/llm-client', () => ({ llmChatCompletion: llmMock }))
// Enforcement is controlled through resolveDecisionEnforceKinds (same pattern as
// temporal-graph-sync.spec.ts): under vitest SvelteKit's $env/dynamic/private is
// a transform-time snapshot, so process.env stubs never reach the real resolver.
vi.mock('$lib/server/llm/decision-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/llm/decision-client')>()
  return { ...actual, resolveDecisionEnforceKinds: resolveEnforceKindsMock }
})
vi.mock('$lib/server/llm/decision-plane', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/llm/decision-plane')>()
  return { ...actual, runEnforcedBoundedDecisions: runEnforcedBoundedDecisionsMock }
})
vi.mock('$lib/server/memory/project-list', () => ({
  loadEligibleGtdProjects: loadProjectsMock,
}))
vi.mock('$lib/server/memory/project-entity', () => ({
  upsertGraphHubEntity: upsertHubMock,
  promoteHubEntityType: promoteTypeMock,
}))
vi.mock('$lib/server/graph/age', () => ({
  fetchEntityEdgesForUser: fetchEdgesMock,
  upsertEntityNode: upsertEntityNodeMock,
}))
vi.mock('$lib/server/crypto/tenant-encryption', () => ({
  decryptTenantValue: decryptMock,
}))

import {
  buildIdentityPrompt,
  effectiveMergeEntityIds,
  loadProjectIdentityContext,
  mergeEntityIdsAllowedForMode,
  mergeProjectEntities,
  parseProjectIdentityPayload,
  resolveProjectIdentity,
  type ProjectIdentityContext,
} from './resolve-project-identity'

const emptyContext: ProjectIdentityContext = {
  gtdProjects: [],
  hubCandidates: [],
  graphNeighborPairs: [],
}

function thenableWhere(limitRows: unknown[], awaitRows: unknown[] = limitRows) {
  const asThenable = {
    limit: vi.fn(async () => limitRows),
    then(onFulfilled?: (value: unknown) => unknown, onRejected?: (error: unknown) => unknown) {
      return Promise.resolve(awaitRows).then(onFulfilled, onRejected)
    },
  }
  return {
    ...asThenable,
    orderBy: vi.fn(() => ({
      limit: vi.fn(async () => limitRows),
      then: asThenable.then.bind(asThenable),
    })),
    groupBy: vi.fn(() => ({
      orderBy: vi.fn(() => ({
        limit: vi.fn(async () => awaitRows),
      })),
    })),
    innerJoin: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => limitRows),
        orderBy: vi.fn(() => ({
          limit: vi.fn(async () => limitRows),
        })),
        groupBy: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(async () => awaitRows),
          })),
        })),
        then: asThenable.then.bind(asThenable),
      })),
    })),
  }
}

describe('resolve-project-identity merge policy', () => {
  it('mergeEntityIdsAllowedForMode allows merge only for seed and reconcile', () => {
    expect(mergeEntityIdsAllowedForMode('seed')).toBe(true)
    expect(mergeEntityIdsAllowedForMode('reconcile')).toBe(true)
    expect(mergeEntityIdsAllowedForMode('promote')).toBe(false)
    expect(mergeEntityIdsAllowedForMode('assign')).toBe(false)
  })

  it('effectiveMergeEntityIds strips ids for promote and assign', () => {
    expect(effectiveMergeEntityIds('promote', ['a', 'b'])).toEqual([])
    expect(effectiveMergeEntityIds('assign', ['a'])).toEqual([])
    expect(effectiveMergeEntityIds('seed', ['a', 'b'])).toEqual(['a', 'b'])
  })

  it('buildIdentityPrompt omits mergeEntityIds schema for promote mode', () => {
    const prompt = buildIdentityPrompt({
      surfaceLabel: 'Kitchen remodel',
      mode: 'promote',
      context: emptyContext,
    })
    expect(prompt).not.toContain('mergeEntityIds')
    expect(prompt).toContain('remain separate projects')
  })

  it('buildIdentityPrompt includes mergeEntityIds schema for seed mode', () => {
    const prompt = buildIdentityPrompt({
      surfaceLabel: 'EigenMesh',
      mode: 'seed',
      context: emptyContext,
    })
    expect(prompt).toContain('mergeEntityIds')
    expect(prompt).toContain('SAME multi-step initiative')
  })

  it('buildIdentityPrompt includes catalogs, neighbors, and thought id', () => {
    const prompt = buildIdentityPrompt({
      surfaceLabel: 'Eigen',
      mode: 'reconcile',
      thoughtId: 't1',
      context: {
        hubCandidates: [
          {
            entityId: 'h1',
            label: 'Eigen',
            entityType: 'organization',
            mentionCount: 3,
            linkedThoughtSummaries: ['Ship MVP'],
          },
        ],
        gtdProjects: [
          {
            entityId: 'p1',
            label: 'EigenMesh',
            status: 'active',
            openTaskCount: 2,
            source: 'capture',
          },
        ],
        graphNeighborPairs: [
          { sourceLabel: 'Eigen', targetLabel: 'Jonas', predicate: 'related_to' },
        ],
      },
    })
    expect(prompt).toContain('Thought id: t1')
    expect(prompt).toContain('p1: EigenMesh')
    expect(prompt).toContain('h1: Eigen')
    expect(prompt).toContain('thoughts: Ship MVP')
    expect(prompt).toContain('Eigen --related_to--> Jonas')
  })
})

describe('parseProjectIdentityPayload', () => {
  const allowed = new Set(['e1', 'e2'])

  it('returns create-hub defaults for non-object raw', () => {
    expect(parseProjectIdentityPayload(null, allowed)).toEqual({
      canonicalEntityId: null,
      canonicalLabel: '',
      hubEntityType: 'organization',
      isGtdProject: false,
      shouldCreateHub: true,
      mergeEntityIds: [],
    })
  })

  it('accepts snake_case keys and filters merge ids to the allowed set', () => {
    const parsed = parseProjectIdentityPayload(
      {
        canonical_entity_id: 'e1',
        canonical_label: ' EigenMesh ',
        hub_entity_type: 'product',
        is_gtd_project: true,
        should_create_hub: false,
        merge_entity_ids: ['e2', 'missing', 'bad id', 3],
      },
      allowed,
    )
    expect(parsed).toEqual({
      canonicalEntityId: 'e1',
      canonicalLabel: 'EigenMesh',
      hubEntityType: 'product',
      isGtdProject: true,
      shouldCreateHub: false,
      mergeEntityIds: ['e2'],
    })
  })

  it('rejects invalid canonical entity ids', () => {
    const parsed = parseProjectIdentityPayload(
      { canonicalEntityId: 'not allowed', isGtdProject: true },
      allowed,
    )
    expect(parsed.canonicalEntityId).toBeNull()
    expect(parsed.isGtdProject).toBe(true)
  })
})

describe('loadProjectIdentityContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadProjectsMock.mockResolvedValue([
      {
        entityId: 'p1',
        label: 'EigenMesh',
        status: 'active',
        openTaskCount: 1,
        source: 'capture',
      },
    ])
    fetchEdgesMock.mockResolvedValue([
      { sourceId: 'h1', targetId: 'p1', predicate: 'related_to' },
      { sourceId: 'unknown', targetId: 'p1', predicate: 'mentions' },
    ])
    decryptMock.mockImplementation(async ({ ciphertext }: { ciphertext: string }) =>
      ciphertext.startsWith('enc:') ? ciphertext.slice(4) : ciphertext,
    )
  })

  it('builds hub candidates, hint label, summaries, and labeled neighbor pairs', async () => {
    const mentionRows = [
      {
        entityId: 'h1',
        label: 'Eigen',
        entityType: 'organization',
        mentionCount: 2,
      },
    ]
    const thoughtRows = [
      {
        normalizedText: null,
        normalizedTextEncrypted: `enc:${'x'.repeat(120)}`,
      },
      { normalizedText: '   ', normalizedTextEncrypted: null },
      { normalizedText: 'Short note', normalizedTextEncrypted: null },
    ]
    const hintRow = {
      entityId: 'hint1',
      label: 'Kitchen remodel',
      entityType: 'project',
    }

    let selectCall = 0
    getDbMock.mockReturnValue({
      select: vi.fn(() => {
        selectCall += 1
        if (selectCall === 1) {
          // mention aggregation
          return {
            from: vi.fn(() => ({
              innerJoin: vi.fn(() => ({
                where: vi.fn(() => ({
                  groupBy: vi.fn(() => ({
                    orderBy: vi.fn(() => ({
                      limit: vi.fn(async () => mentionRows),
                    })),
                  })),
                })),
              })),
            })),
          }
        }
        if (selectCall === 2 || selectCall === 4) {
          // summarizeLinkedThoughts for hub / hint
          return {
            from: vi.fn(() => ({
              innerJoin: vi.fn(() => ({
                where: vi.fn(() => ({
                  limit: vi.fn(async () => thoughtRows),
                })),
              })),
            })),
          }
        }
        // hint label lookup
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(async () => [hintRow]),
            })),
          })),
        }
      }),
    })

    const ctx = await loadProjectIdentityContext('u1', 'Kitchen remodel')
    expect(ctx.gtdProjects).toHaveLength(1)
    expect(ctx.hubCandidates[0]?.entityId).toBe('hint1')
    expect(ctx.hubCandidates.some((c) => c.entityId === 'h1')).toBe(true)
    expect(ctx.hubCandidates.find((c) => c.entityId === 'h1')?.linkedThoughtSummaries[0]).toMatch(
      /…$/,
    )
    expect(ctx.graphNeighborPairs).toEqual([
      { sourceLabel: 'Eigen', targetLabel: 'EigenMesh', predicate: 'related_to' },
    ])
  })
})

describe('resolveProjectIdentity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadProjectsMock.mockResolvedValue([])
    fetchEdgesMock.mockResolvedValue([])
    upsertHubMock.mockResolvedValue('new-hub')
    promoteTypeMock.mockResolvedValue(undefined)
    upsertEntityNodeMock.mockResolvedValue(undefined)
    resolveEnforceKindsMock.mockReturnValue(new Set())
    runEnforcedBoundedDecisionsMock.mockResolvedValue(new Map())
  })

  it('rejects blank surface labels', async () => {
    await expect(
      resolveProjectIdentity({ userId: 'u1', surfaceLabel: '  ', mode: 'assign' }),
    ).rejects.toThrow(/surfaceLabel is required/)
  })

  it('uses existing canonical entity id from LLM when present', async () => {
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              groupBy: vi.fn(() => ({
                orderBy: vi.fn(() => ({
                  limit: vi.fn(async () => [
                    {
                      entityId: 'h1',
                      label: 'Eigen',
                      entityType: 'organization',
                      mentionCount: 1,
                    },
                  ]),
                })),
              })),
              limit: vi.fn(async () => [{ normalizedText: 'note', normalizedTextEncrypted: null }]),
            })),
          })),
          where: vi.fn(() => thenableWhere([{ entityId: 'h1' }], [{ entityId: 'h1' }])),
        })),
      })),
    })
    llmMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              canonicalEntityId: 'h1',
              canonicalLabel: 'Eigen',
              hubEntityType: 'organization',
              isGtdProject: true,
              shouldCreateHub: false,
              mergeEntityIds: ['h1'],
            }),
          },
        },
      ],
    })

    const result = await resolveProjectIdentity({
      userId: 'u1',
      surfaceLabel: 'Eigen',
      mode: 'assign',
      thoughtId: 't1',
    })

    expect(result.entityId).toBe('h1')
    expect(result.isGtdProject).toBe(true)
    expect(result.mergeEntityIds).toEqual([])
    expect(upsertHubMock).not.toHaveBeenCalled()
  })

  it('creates a hub when LLM returns null canonical id', async () => {
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              groupBy: vi.fn(() => ({
                orderBy: vi.fn(() => ({
                  limit: vi.fn(async () => []),
                })),
              })),
              limit: vi.fn(async () => []),
            })),
          })),
          where: vi.fn(() => thenableWhere([], [])),
        })),
      })),
    })
    llmMock.mockResolvedValue({
      choices: [
        {
          message: {
            content:
              '```json\n{"canonicalEntityId":null,"canonicalLabel":"","isGtdProject":false,"shouldCreateHub":true}\n```',
          },
        },
      ],
    })

    const result = await resolveProjectIdentity({
      userId: 'u1',
      surfaceLabel: 'New Initiative',
      mode: 'seed',
    })

    expect(upsertHubMock).toHaveBeenCalledWith('u1', 'New Initiative', 'organization')
    expect(result.entityId).toBe('new-hub')
    expect(result.canonicalLabel).toBe('New Initiative')
  })

  it('throws when LLM content is missing', async () => {
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              groupBy: vi.fn(() => ({
                orderBy: vi.fn(() => ({
                  limit: vi.fn(async () => []),
                })),
              })),
              limit: vi.fn(async () => []),
            })),
          })),
          where: vi.fn(() => thenableWhere([], [])),
        })),
      })),
    })
    llmMock.mockResolvedValue({ choices: [{}] })
    await expect(
      resolveProjectIdentity({ userId: 'u1', surfaceLabel: 'X', mode: 'promote' }),
    ).rejects.toThrow(/missing LLM content/)
  })

  it('keeps the chat-judge path when resolution_choice is not enforced', async () => {
    resolveEnforceKindsMock.mockReturnValue(new Set())
    mockDbSteps([...contextSteps(jevCandidates), { kind: 'whereThenable', rows: [] }])
    llmMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              canonicalEntityId: HUB_A,
              canonicalLabel: 'Eigen',
              hubEntityType: 'organization',
              isGtdProject: true,
              shouldCreateHub: false,
              mergeEntityIds: [],
            }),
          },
        },
      ],
    })

    const result = await resolveProjectIdentity({
      userId: 'u1',
      surfaceLabel: 'Eigen',
      mode: 'seed',
    })

    expect(runEnforcedBoundedDecisionsMock).not.toHaveBeenCalled()
    expect(llmMock).toHaveBeenCalledTimes(1)
    expect(result.entityId).toBe(HUB_A)
    expect(result.isGtdProject).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Jev resolution_choice enforcement: the Decisions API decides the canonical
// hub + merge set; the qwen chat judge only arbitrates on low confidence.
// ---------------------------------------------------------------------------

type SelectStep =
  | { kind: 'agg'; rows: unknown[] }
  | { kind: 'joinLimit'; rows: unknown[] }
  | { kind: 'whereLimit'; rows: unknown[] }
  | { kind: 'whereThenable'; rows: unknown[] }

const HUB_A = '11111111-1111-4111-8111-111111111111'
const HUB_B = '22222222-2222-4222-8222-222222222222'
const HUB_C = '33333333-3333-4333-8333-333333333333'

const jevCandidates = [
  { entityId: HUB_A, label: 'Eigen', entityType: 'organization', mentionCount: 4 },
  { entityId: HUB_B, label: 'EigenMesh', entityType: 'project', mentionCount: 2 },
  { entityId: HUB_C, label: 'Aygen', entityType: 'other', mentionCount: 1 },
]

/** Select sequence of loadProjectIdentityContext: aggregation, per-hub summaries, hint lookup. */
function contextSteps(candidates: Array<{ entityId: string }>): SelectStep[] {
  return [
    { kind: 'agg', rows: candidates },
    ...candidates.map(() => ({ kind: 'joinLimit' as const, rows: [] })),
    { kind: 'whereLimit', rows: [] },
  ]
}

function mockDbSteps(steps: SelectStep[]) {
  const insertMock = vi.fn(() => ({
    values: vi.fn(() => ({ onConflictDoNothing: vi.fn(async () => undefined) })),
  }))
  const updateMock = vi.fn(() => ({
    set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
  }))
  const deleteMock = vi.fn(() => ({ where: vi.fn(async () => undefined) }))
  let selectCall = 0
  const selectFn = vi.fn(() => {
    const step: SelectStep = steps[selectCall] ?? { kind: 'whereThenable', rows: [] }
    selectCall += 1
    if (step.kind === 'agg') {
      return {
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              groupBy: vi.fn(() => ({
                orderBy: vi.fn(() => ({ limit: vi.fn(async () => step.rows) })),
              })),
            })),
          })),
        })),
      }
    }
    if (step.kind === 'joinLimit') {
      return {
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({ limit: vi.fn(async () => step.rows) })),
          })),
        })),
      }
    }
    if (step.kind === 'whereLimit') {
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: vi.fn(async () => step.rows) })),
        })),
      }
    }
    return {
      from: vi.fn(() => ({
        where: vi.fn(() => thenableWhere(step.rows, step.rows)),
      })),
    }
  })
  getDbMock.mockReturnValue({
    select: selectFn,
    insert: insertMock,
    update: updateMock,
    delete: deleteMock,
  })
  return { insertMock, updateMock, deleteMock }
}

function decisionAnswer(choice: string, probabilities: Record<string, number>) {
  return { type: 'choice' as const, choice, probabilities, confidence: probabilities[choice] ?? 0 }
}

function enforcedCall() {
  expect(runEnforcedBoundedDecisionsMock).toHaveBeenCalledTimes(1)
  return runEnforcedBoundedDecisionsMock.mock.calls[0][0] as {
    userId: string
    surface: string
    state: string
    specs: Array<{
      decisionKind: string
      id: string
      question: { type: string; instructions: string; criteria: Record<string, string> }
      llmChoice: string | null
    }>
  }
}

describe('resolveProjectIdentity under Jev resolution_choice enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadProjectsMock.mockResolvedValue([])
    fetchEdgesMock.mockResolvedValue([])
    upsertHubMock.mockResolvedValue('new-hub')
    promoteTypeMock.mockResolvedValue(undefined)
    upsertEntityNodeMock.mockResolvedValue(undefined)
    resolveEnforceKindsMock.mockReturnValue(new Set(['resolution_choice']))
  })

  it('canonical=create creates a new project hub with no merges and never calls the chat judge', async () => {
    mockDbSteps(contextSteps(jevCandidates))
    // Winning probability exactly 0.6 — the escalation band is strictly below.
    runEnforcedBoundedDecisionsMock.mockResolvedValue(
      new Map([
        ['canonical', decisionAnswer('create', { create: 0.6, [HUB_A]: 0.3, [HUB_B]: 0.1 })],
        ['merge-0', decisionAnswer('keep', { keep: 0.9, merge: 0.1 })],
        ['merge-1', decisionAnswer('keep', { keep: 0.9, merge: 0.1 })],
        ['merge-2', decisionAnswer('keep', { keep: 0.9, merge: 0.1 })],
      ]),
    )

    const result = await resolveProjectIdentity({
      userId: 'u1',
      surfaceLabel: 'Eigen',
      mode: 'seed',
    })

    expect(llmMock).not.toHaveBeenCalled()
    expect(upsertHubMock).toHaveBeenCalledWith('u1', 'Eigen', 'project')
    expect(result).toEqual({
      entityId: 'new-hub',
      canonicalLabel: 'Eigen',
      hubEntityType: 'project',
      isGtdProject: false,
      shouldCreateHub: true,
      mergeEntityIds: [],
    })
    expect(promoteTypeMock).not.toHaveBeenCalled()
    expect(upsertEntityNodeMock).not.toHaveBeenCalled()

    const call = enforcedCall()
    expect(call.userId).toBe('u1')
    expect(call.surface).toBe('resolution')
    expect(JSON.parse(call.state)).toEqual({
      workName: 'Eigen',
      candidateHubs: [
        { id: HUB_A, label: 'Eigen', thoughtCount: 4, entityType: 'organization' },
        { id: HUB_B, label: 'EigenMesh', thoughtCount: 2, entityType: 'project' },
        { id: HUB_C, label: 'Aygen', thoughtCount: 1, entityType: 'other' },
      ],
    })
    expect(call.specs).toHaveLength(4)
    const [canonicalSpec, ...mergeSpecs] = call.specs
    expect(canonicalSpec.decisionKind).toBe('resolution_choice')
    expect(canonicalSpec.id).toBe('canonical')
    expect(canonicalSpec.llmChoice).toBeNull()
    expect(canonicalSpec.question.type).toBe('choice')
    // Hub UUIDs are opaque criteria keys and must survive the API round-trip.
    expect(Object.keys(canonicalSpec.question.criteria)).toEqual([HUB_A, HUB_B, HUB_C, 'create'])
    expect(canonicalSpec.question.criteria[HUB_A]).toBe(
      'Existing hub "Eigen" with 4 linked thoughts (type organization)',
    )
    expect(canonicalSpec.question.criteria.create).toBe(
      'No existing hub matches — create a new hub for this name.',
    )
    for (const [index, spec] of mergeSpecs.entries()) {
      expect(spec.decisionKind).toBe('resolution_choice')
      expect(spec.id).toBe(`merge-${index}`)
      expect(spec.llmChoice).toBeNull()
      expect(spec.question.criteria).toEqual({
        merge: 'Merge this hub into the canonical hub — same work under duplicate naming.',
        keep: 'Keep this hub separate — distinct work despite name similarity.',
      })
    }
  })

  it('canonical=hub A merges B (merge) and keeps C (keep) with full persistence', async () => {
    const steps: SelectStep[] = [
      ...contextSteps(jevCandidates),
      { kind: 'whereThenable', rows: [] }, // merge safeguard: no manual projects
      {
        kind: 'whereLimit',
        rows: [
          {
            id: HUB_A,
            label: 'Eigen',
            canonicalKey: 'eigen',
            entityType: 'organization',
            source: 'capture',
          },
        ], // winner row
      },
      {
        kind: 'whereThenable',
        rows: [{ id: HUB_B, canonicalKey: 'eigenmesh', label: 'EigenMesh' }], // loser rows
      },
      { kind: 'whereThenable', rows: [] }, // loser thought links
      { kind: 'whereLimit', rows: [] }, // loser project profile (none)
    ]
    const { insertMock, updateMock } = mockDbSteps(steps)
    runEnforcedBoundedDecisionsMock.mockResolvedValue(
      new Map([
        ['canonical', decisionAnswer(HUB_A, { [HUB_A]: 0.85, [HUB_B]: 0.1, create: 0.05 })],
        // The canonical hub's own merge spec is ignored — it never merges into itself.
        ['merge-0', decisionAnswer('merge', { merge: 0.9, keep: 0.1 })],
        ['merge-1', decisionAnswer('merge', { merge: 0.9, keep: 0.1 })],
        ['merge-2', decisionAnswer('keep', { keep: 0.9, merge: 0.1 })],
      ]),
    )

    const result = await resolveProjectIdentity({
      userId: 'u1',
      surfaceLabel: 'Eigen',
      mode: 'seed',
    })

    expect(llmMock).not.toHaveBeenCalled()
    expect(result.entityId).toBe(HUB_A)
    expect(result.canonicalLabel).toBe('Eigen')
    expect(result.hubEntityType).toBe('organization')
    expect(result.isGtdProject).toBe(false)
    expect(result.shouldCreateHub).toBe(false)
    expect(result.mergeEntityIds).toEqual([HUB_B])
    expect(upsertHubMock).not.toHaveBeenCalled()
    expect(promoteTypeMock).toHaveBeenCalledWith('u1', HUB_A, 'Eigen')
    expect(upsertEntityNodeMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: HUB_A, label: 'Eigen', entityType: 'project' }),
    )
    expect(insertMock).toHaveBeenCalled()
    expect(updateMock).toHaveBeenCalled()
  })

  it('escalates to the chat judge below 0.6 winning probability and its full result wins', async () => {
    mockDbSteps([...contextSteps(jevCandidates), { kind: 'whereThenable', rows: [] }])
    runEnforcedBoundedDecisionsMock.mockResolvedValue(
      new Map([
        ['canonical', decisionAnswer(HUB_A, { [HUB_A]: 0.45, [HUB_B]: 0.35, create: 0.2 })],
        ['merge-0', decisionAnswer('keep', { keep: 0.9, merge: 0.1 })],
        ['merge-1', decisionAnswer('keep', { keep: 0.9, merge: 0.1 })],
        ['merge-2', decisionAnswer('keep', { keep: 0.9, merge: 0.1 })],
      ]),
    )
    llmMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              canonicalEntityId: HUB_B,
              canonicalLabel: 'EigenMesh Initiative',
              hubEntityType: 'product',
              isGtdProject: true,
              shouldCreateHub: false,
              mergeEntityIds: [],
            }),
          },
        },
      ],
    })

    const result = await resolveProjectIdentity({
      userId: 'u1',
      surfaceLabel: 'Eigen',
      mode: 'seed',
    })

    expect(runEnforcedBoundedDecisionsMock).toHaveBeenCalledTimes(1)
    expect(llmMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      entityId: HUB_B,
      canonicalLabel: 'EigenMesh Initiative',
      hubEntityType: 'product',
      isGtdProject: true,
      shouldCreateHub: false,
      mergeEntityIds: [],
    })
    expect(upsertHubMock).not.toHaveBeenCalled()
  })

  it('propagates Decisions API failures — no silent create, no chat fallback', async () => {
    mockDbSteps(contextSteps(jevCandidates))
    runEnforcedBoundedDecisionsMock.mockRejectedValue(
      new Error('[decision-plane] enforced bounded decision(s) failed: gateway down'),
    )

    await expect(
      resolveProjectIdentity({ userId: 'u1', surfaceLabel: 'Eigen', mode: 'seed' }),
    ).rejects.toThrow(/gateway down/)

    expect(llmMock).not.toHaveBeenCalled()
    expect(upsertHubMock).not.toHaveBeenCalled()
  })
})

describe('mergeProjectEntities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    promoteTypeMock.mockResolvedValue(undefined)
    upsertEntityNodeMock.mockResolvedValue(undefined)
  })

  it('no-ops when loser list is empty after filtering winner', async () => {
    await mergeProjectEntities('u1', 'winner', ['winner'])
    expect(getDbMock).not.toHaveBeenCalled()
  })

  it('refuses to merge manual losers and returns when only manuals remain', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() =>
            thenableWhere(
              [{ entityId: 'loser1', source: 'manual' }],
              [{ entityId: 'loser1', source: 'manual' }],
            ),
          ),
        })),
      })),
    })

    await mergeProjectEntities('u1', 'winner', ['loser1'])
    expect(errorSpy).toHaveBeenCalledWith(
      '[merge-projects] Refusing to merge manual projects',
      expect.objectContaining({
        manualLosers: ['loser1'],
      }),
    )
    errorSpy.mockRestore()
  })

  it('throws when winner hub is missing', async () => {
    let selectCall = 0
    getDbMock.mockReturnValue({
      select: vi.fn(() => {
        selectCall += 1
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => {
              if (selectCall === 1) {
                return thenableWhere([], []) // no manual losers
              }
              return thenableWhere([], []) // winner missing
            }),
          })),
        }
      }),
    })

    await expect(mergeProjectEntities('u1', 'winner', ['loser1'])).rejects.toThrow(
      /winner winner not found/,
    )
  })

  it('merges non-manual losers: relinks thoughts, aliases, and demotes project status', async () => {
    const insertMock = vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(async () => undefined),
      })),
    }))
    const updateMock = vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => undefined),
      })),
    }))
    const deleteMock = vi.fn(() => ({
      where: vi.fn(async () => undefined),
    }))

    let selectCall = 0
    getDbMock.mockReturnValue({
      select: vi.fn(() => {
        selectCall += 1
        const n = selectCall
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => {
              if (n === 1) {
                // manual safeguard query
                return thenableWhere(
                  [{ entityId: 'loser1', source: 'capture' }],
                  [{ entityId: 'loser1', source: 'capture' }],
                )
              }
              if (n === 2) {
                // winner row
                return thenableWhere(
                  [
                    {
                      id: 'winner',
                      label: 'Old',
                      canonicalKey: 'old',
                      entityType: 'organization',
                      source: 'capture',
                    },
                  ],
                  [],
                )
              }
              if (n === 3) {
                // loser rows
                return thenableWhere(
                  [],
                  [
                    {
                      id: 'loser1',
                      canonicalKey: 'eigenmesh',
                      label: 'EigenMesh',
                    },
                  ],
                )
              }
              if (n === 4) {
                // thought links
                return thenableWhere([], [{ thoughtId: 't1' }])
              }
              if (n === 5) {
                // loser project
                return thenableWhere(
                  [
                    {
                      nextActionThoughtId: 'na1',
                      status: 'active',
                      source: 'capture',
                    },
                  ],
                  [],
                )
              }
              // winner project missing -> adopt loser project fields
              return thenableWhere([], [])
            }),
          })),
        }
      }),
      insert: insertMock,
      update: updateMock,
      delete: deleteMock,
    })

    await mergeProjectEntities('u1', 'winner', ['loser1'], 'Eigen')

    expect(insertMock).toHaveBeenCalled()
    expect(deleteMock).toHaveBeenCalled()
    expect(updateMock).toHaveBeenCalled()
    expect(promoteTypeMock).toHaveBeenCalledWith('u1', 'winner', 'Eigen')
    expect(upsertEntityNodeMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'winner', label: 'Eigen', entityType: 'project' }),
    )
  })
})
