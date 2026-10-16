import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getDbMock,
  llmMock,
  decryptMock,
  countLinkedMock,
  countOpenMock,
  demoteMock,
  restoreMock,
  resolveEnforceKindsMock,
  runBoundedDecisionsMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  llmMock: vi.fn(),
  decryptMock: vi.fn(),
  countLinkedMock: vi.fn(),
  countOpenMock: vi.fn(),
  demoteMock: vi.fn(),
  restoreMock: vi.fn(),
  resolveEnforceKindsMock: vi.fn(),
  runBoundedDecisionsMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }))
vi.mock('$lib/server/llm/llm-client', () => ({ llmChatCompletion: llmMock }))
vi.mock('$lib/server/crypto/tenant-encryption', () => ({
  decryptTenantValue: decryptMock,
}))
vi.mock('$lib/server/memory/project-eligibility', () => ({
  countLinkedThoughtsForProjectEntity: countLinkedMock,
  countOpenTasksForProjectEntity: countOpenMock,
  demoteProject: demoteMock,
  restoreProjectListing: restoreMock,
}))
vi.mock('$lib/paraglide/messages.js', () => ({
  m: {
    llm_gtd_judge_system: () => 'Judge GTD projects.',
  },
}))
// Enforcement is controlled through resolveDecisionEnforceKinds (same pattern
// as temporal-graph-sync.spec.ts): under vitest SvelteKit's $env/dynamic/private
// is a transform-time snapshot, so process.env stubs never reach the real resolver.
vi.mock('$lib/server/llm/decision-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/llm/decision-client')>()
  return { ...actual, resolveDecisionEnforceKinds: resolveEnforceKindsMock }
})
vi.mock('$lib/server/llm/decision-plane', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/llm/decision-plane')>()
  return { ...actual, runEnforcedBoundedDecisions: runBoundedDecisionsMock }
})

// Enforcement OFF by default — every qwen-path test keeps today's behavior.
beforeEach(() => {
  resolveEnforceKindsMock.mockReturnValue(new Set())
})

import {
  auditGtdProjectProfiles,
  judgeGtdProjectHub,
  loadHubJudgmentContext,
  parseGtdProjectAuditBatchPayload,
  parseGtdProjectJudgmentPayload,
  shouldInvokeGtdProjectJudge,
} from './judge-gtd-project'

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
  }
}

/** from() supports both entity `.where().limit()` and thought `.innerJoin().where().orderBy().limit()`. */
function makeFromChain(options: {
  entityRows?: unknown[]
  thoughtRows?: unknown[]
  awaitRows?: unknown[]
}) {
  const entityRows = options.entityRows ?? []
  const thoughtRows = options.thoughtRows ?? []
  const awaitRows = options.awaitRows ?? entityRows
  return {
    where: vi.fn(() => thenableWhere(entityRows, awaitRows)),
    innerJoin: vi.fn(() => ({
      where: vi.fn(() => ({
        orderBy: vi.fn(() => ({
          limit: vi.fn(async () => thoughtRows),
        })),
      })),
    })),
  }
}

/** First select is the hub entity, later selects are the linked thoughts. */
function mockHubDb(
  thoughtRows: unknown[] = [],
  entity: { label: string; entityType: string } = { label: 'Eigen', entityType: 'organization' },
) {
  let selectCall = 0
  getDbMock.mockReturnValue({
    select: vi.fn(() => {
      selectCall += 1
      if (selectCall === 1) {
        return {
          from: vi.fn(() => makeFromChain({ entityRows: [entity] })),
        }
      }
      return {
        from: vi.fn(() => makeFromChain({ thoughtRows })),
      }
    }),
  })
}

function thoughtRow(text: string, category = 'observation') {
  return { normalizedText: text, normalizedTextEncrypted: null, category }
}

describe('judge-gtd-project parsers and gate', () => {
  it('parseGtdProjectJudgmentPayload reads isGtdProject and snake_case label', () => {
    expect(
      parseGtdProjectJudgmentPayload({ isGtdProject: true, canonicalLabel: 'EigenMesh' }, 'Eigen'),
    ).toEqual({
      isGtdProject: true,
      canonicalLabel: 'EigenMesh',
    })
    expect(
      parseGtdProjectJudgmentPayload({ is_gtd_project: true, canonical_label: 'X' }, 'fb'),
    ).toEqual({
      isGtdProject: true,
      canonicalLabel: 'X',
    })
    expect(parseGtdProjectJudgmentPayload(null, 'roasted garlic')).toEqual({
      isGtdProject: false,
      canonicalLabel: 'roasted garlic',
    })
    expect(parseGtdProjectJudgmentPayload({ isGtdProject: false }, 'roasted garlic')).toEqual({
      isGtdProject: false,
      canonicalLabel: 'roasted garlic',
    })
  })

  it('shouldInvokeGtdProjectJudge requires evidence before LLM spend', () => {
    expect(shouldInvokeGtdProjectJudge({ linkedThoughtCount: 1, openTaskCount: 0 })).toBe(false)
    expect(shouldInvokeGtdProjectJudge({ linkedThoughtCount: 2, openTaskCount: 0 })).toBe(false)
    expect(shouldInvokeGtdProjectJudge({ linkedThoughtCount: 3, openTaskCount: 0 })).toBe(true)
    expect(shouldInvokeGtdProjectJudge({ linkedThoughtCount: 2, openTaskCount: 1 })).toBe(true)
    expect(shouldInvokeGtdProjectJudge({ linkedThoughtCount: 0, openTaskCount: 2 })).toBe(true)
    expect(
      shouldInvokeGtdProjectJudge({ linkedThoughtCount: 0, openTaskCount: 0, force: true }),
    ).toBe(true)
  })

  it('parseGtdProjectAuditBatchPayload validates entity ids and snake_case', () => {
    const allowed = new Set(['a', 'b'])
    const parsed = parseGtdProjectAuditBatchPayload(
      {
        results: [
          { entityId: 'a', isGtdProject: false },
          { entity_id: 'b', is_gtd_project: true, canonical_label: 'EigenMesh' },
          { entityId: 'c', isGtdProject: true },
          null,
          'bad',
        ],
      },
      allowed,
    )
    expect(parsed).toEqual([
      { entityId: 'a', isGtdProject: false, canonicalLabel: '' },
      { entityId: 'b', isGtdProject: true, canonicalLabel: 'EigenMesh' },
    ])
    expect(parseGtdProjectAuditBatchPayload(null, allowed)).toEqual([])
    expect(parseGtdProjectAuditBatchPayload({ results: 'x' }, allowed)).toEqual([])
  })
})

describe('loadHubJudgmentContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    countLinkedMock.mockResolvedValue(3)
    countOpenMock.mockResolvedValue(1)
    decryptMock.mockImplementation(async ({ ciphertext }: { ciphertext: string }) =>
      ciphertext.startsWith('enc:') ? ciphertext.slice(4) : ciphertext,
    )
  })

  it('returns null when entity is missing', async () => {
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => makeFromChain({ entityRows: [] })),
      })),
    })
    await expect(loadHubJudgmentContext('u1', 'e1')).resolves.toBeNull()
  })

  it('loads summaries including encrypted and task rows', async () => {
    const longText = `${'x'.repeat(200)}`
    let selectCall = 0
    getDbMock.mockReturnValue({
      select: vi.fn(() => {
        selectCall += 1
        if (selectCall === 1) {
          return {
            from: vi.fn(() =>
              makeFromChain({
                entityRows: [{ label: 'EigenMesh', entityType: 'organization' }],
              }),
            ),
          }
        }
        return {
          from: vi.fn(() =>
            makeFromChain({
              thoughtRows: [
                {
                  normalizedText: null,
                  normalizedTextEncrypted: `enc:${longText}`,
                  category: 'observation',
                },
                {
                  normalizedText: '   ',
                  normalizedTextEncrypted: null,
                  category: 'task',
                },
                {
                  normalizedText: 'Ship MVP',
                  normalizedTextEncrypted: null,
                  category: 'task',
                },
              ],
            }),
          ),
        }
      }),
    })

    const ctx = await loadHubJudgmentContext('u1', 'e1')
    expect(ctx).toMatchObject({
      entityId: 'e1',
      label: 'EigenMesh',
      linkedThoughtCount: 3,
      openTaskCount: 1,
    })
    expect(ctx?.linkedThoughtSummaries[0]).toMatch(/…$/)
    expect(ctx?.openTaskSummaries).toEqual(['Ship MVP'])
  })
})

describe('judgeGtdProjectHub', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    countLinkedMock.mockResolvedValue(3)
    countOpenMock.mockResolvedValue(1)
    decryptMock.mockResolvedValue('plain')
  })

  it('returns null when hub context is missing', async () => {
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => makeFromChain({ entityRows: [] })),
      })),
    })
    await expect(judgeGtdProjectHub('u1', 'missing')).resolves.toBeNull()
    expect(llmMock).not.toHaveBeenCalled()
  })

  it('skips LLM when evidence gate fails', async () => {
    countLinkedMock.mockResolvedValue(1)
    countOpenMock.mockResolvedValue(0)
    mockHubDb([{ normalizedText: 'one', normalizedTextEncrypted: null, category: 'observation' }])
    await expect(judgeGtdProjectHub('u1', 'e1')).resolves.toEqual({
      isGtdProject: false,
      canonicalLabel: 'Eigen',
    })
    expect(llmMock).not.toHaveBeenCalled()
  })

  it('calls LLM and parses judgment when gate passes', async () => {
    mockHubDb([
      { normalizedText: 'Build EigenMesh', normalizedTextEncrypted: null, category: 'task' },
    ])
    llmMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: '```json\n{"isGtdProject":true,"canonicalLabel":"EigenMesh"}\n```',
          },
        },
      ],
    })
    await expect(judgeGtdProjectHub('u1', 'e1', { force: true })).resolves.toEqual({
      isGtdProject: true,
      canonicalLabel: 'EigenMesh',
    })
    expect(llmMock).toHaveBeenCalled()
  })

  it('throws when LLM content is missing', async () => {
    mockHubDb([])
    llmMock.mockResolvedValue({ choices: [{}] })
    await expect(judgeGtdProjectHub('u1', 'e1', { force: true })).rejects.toThrow(
      /missing LLM content/,
    )
  })
})

describe('auditGtdProjectProfiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    countLinkedMock.mockResolvedValue(2)
    countOpenMock.mockResolvedValue(1)
    demoteMock.mockResolvedValue(true)
    restoreMock.mockResolvedValue(undefined)
  })

  it('returns demoted 0 when no capture projects exist', async () => {
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => [{ entityId: 'm1', source: 'manual' }]),
        })),
      })),
    })
    await expect(auditGtdProjectProfiles('u1')).resolves.toEqual({ demoted: 0 })
    expect(llmMock).not.toHaveBeenCalled()
  })

  it('demotes false positives from the LLM audit batch', async () => {
    let selectCall = 0
    getDbMock.mockReturnValue({
      select: vi.fn(() => {
        selectCall += 1
        if (selectCall === 1) {
          return {
            from: vi.fn(() => ({
              where: vi.fn(async () => [
                { entityId: 'e1', source: 'capture' },
                { entityId: 'e2', source: 'capture' },
              ]),
            })),
          }
        }
        if (selectCall === 2 || selectCall === 4) {
          return {
            from: vi.fn(() =>
              makeFromChain({
                entityRows: [
                  {
                    label: selectCall === 2 ? 'garlic' : 'Eigen',
                    entityType: 'concept',
                  },
                ],
              }),
            ),
          }
        }
        return {
          from: vi.fn(() =>
            makeFromChain({
              thoughtRows: [
                {
                  normalizedText: 'note',
                  normalizedTextEncrypted: null,
                  category: 'observation',
                },
              ],
            }),
          ),
        }
      }),
    })
    llmMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              results: [
                { entityId: 'e1', isGtdProject: false, canonicalLabel: 'garlic' },
                { entityId: 'e2', isGtdProject: true, canonicalLabel: 'Eigen' },
              ],
            }),
          },
        },
      ],
    })

    await expect(auditGtdProjectProfiles('u1')).resolves.toEqual({ demoted: 1 })
    expect(demoteMock).toHaveBeenCalledTimes(1)
    expect(demoteMock).toHaveBeenCalledWith('u1', 'e1')
    expect(restoreMock).not.toHaveBeenCalled()
  })

  it('rolls back when LLM demotes every capture project', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let selectCall = 0
    getDbMock.mockReturnValue({
      select: vi.fn(() => {
        selectCall += 1
        if (selectCall === 1) {
          return {
            from: vi.fn(() => ({
              where: vi.fn(async () => [{ entityId: 'e1', source: 'capture' }]),
            })),
          }
        }
        if (selectCall === 2) {
          return {
            from: vi.fn(() =>
              makeFromChain({
                entityRows: [{ label: 'x', entityType: 'concept' }],
              }),
            ),
          }
        }
        return {
          from: vi.fn(() => makeFromChain({ thoughtRows: [] })),
        }
      }),
    })
    llmMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              results: [{ entityId: 'e1', isGtdProject: false }],
            }),
          },
        },
      ],
    })

    await expect(auditGtdProjectProfiles('u1')).resolves.toEqual({ demoted: 0 })
    expect(restoreMock).toHaveBeenCalledWith('u1', 'e1', 'active', 'capture')
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

/** A Decisions API answer shape for the gtd_promotion catalog ('true'/'false'). */
type JevAnswer = {
  type: 'choice'
  choice: 'true' | 'false'
  probabilities: Record<string, number>
  confidence: number
}

function jevAnswer(choice: 'true' | 'false', pTrue: number): JevAnswer {
  return {
    type: 'choice',
    choice,
    probabilities: { true: pTrue, false: 1 - pTrue },
    confidence: Math.max(pTrue, 1 - pTrue),
  }
}

function jevMap(entries: Array<readonly [string, JevAnswer]>): Map<string, JevAnswer> {
  return new Map(entries)
}

/** Audit flow: select 1 is the project rows, then per hub entity + thought selects. */
function mockAuditHubDb(
  hubs: Array<{ id: string; label: string; entityType: string; thought?: string }>,
) {
  let selectCall = 0
  getDbMock.mockReturnValue({
    select: vi.fn(() => {
      selectCall += 1
      if (selectCall === 1) {
        return {
          from: vi.fn(() => ({
            where: vi.fn(async () => hubs.map((hub) => ({ entityId: hub.id, source: 'capture' }))),
          })),
        }
      }
      const hub = hubs[Math.floor((selectCall - 2) / 2)]
      if ((selectCall - 2) % 2 === 0) {
        return {
          from: vi.fn(() =>
            makeFromChain({ entityRows: [{ label: hub.label, entityType: hub.entityType }] }),
          ),
        }
      }
      return {
        from: vi.fn(() => makeFromChain({ thoughtRows: hub.thought ? [thoughtRow(hub.thought)] : [] })),
      }
    }),
  })
}

describe('judgeGtdProjectHub — gtd_promotion enforced (Jev)', () => {
  const negativeFixtures = [
    {
      name: 'ingredient hub',
      entityId: 'hub-entity-garlic',
      label: 'Roasted garlic',
      entityType: 'ingredient',
      linked: 3,
      open: 1,
      thought: 'Roast the garlic slowly until it turns sweet for the Sunday ragu',
    },
    {
      name: 'relative hub',
      entityId: 'hub-entity-schwester',
      label: 'Schwester',
      entityType: 'person',
      linked: 4,
      open: 0,
      thought: 'Schwester called about Omas Geburtstag am Samstag',
    },
    {
      name: 'single one-off task hub',
      entityId: 'hub-entity-tax',
      label: 'Tax filing 2025',
      entityType: 'task',
      linked: 2,
      open: 1,
      thought: 'Submit the 2025 tax filing — one appointment, then done',
    },
    {
      name: 'frequently co-mentioned concept hub',
      entityId: 'hub-entity-eu',
      label: 'EU',
      entityType: 'concept',
      linked: 14,
      open: 0,
      thought: 'The EU AI Act timeline came up again in the compliance newsletter',
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    resolveEnforceKindsMock.mockReturnValue(new Set(['gtd_promotion']))
    decryptMock.mockResolvedValue('plain')
  })

  it.each(negativeFixtures)('NEGATIVE — $name does not become a GTD project', async (fixture) => {
    countLinkedMock.mockResolvedValue(fixture.linked)
    countOpenMock.mockResolvedValue(fixture.open)
    mockHubDb([thoughtRow(fixture.thought)], { label: fixture.label, entityType: fixture.entityType })
    runBoundedDecisionsMock.mockResolvedValue(jevMap([['hub-0', jevAnswer('false', 0.05)]]))

    await expect(judgeGtdProjectHub('u1', fixture.entityId)).resolves.toEqual({
      isGtdProject: false,
      canonicalLabel: fixture.label,
    })
    expect(runBoundedDecisionsMock).toHaveBeenCalledTimes(1)
    // Outside the band qwen is not called — Jev alone decided against promotion.
    expect(llmMock).not.toHaveBeenCalled()

    // The judge's input is the rich hub context, not a mention count.
    const state = JSON.parse(runBoundedDecisionsMock.mock.calls[0][0].state)
    expect(state.hubs[0].label).toBe(fixture.label)
    expect(state.hubs[0].entityType).toBe(fixture.entityType)
    expect(state.hubs[0].linkedThoughtCount).toBe(fixture.linked)
    expect(state.hubs[0].openTaskCount).toBe(fixture.open)
  })

  it('POSITIVE — promotes a multi-step initiative and feeds the summaries to the judge', async () => {
    const summaries = [
      'Design the decision-plane contract for GTD',
      'Ship bounded decisions behind DECISION_ENFORCE_KINDS',
      'Wire the gtd_judge surface into the audit batch',
    ]
    countLinkedMock.mockResolvedValue(5)
    countOpenMock.mockResolvedValue(3)
    mockHubDb(
      [
        thoughtRow(summaries[0], 'task'),
        thoughtRow(summaries[1], 'task'),
        thoughtRow(summaries[2]),
        thoughtRow('Pick a release name', 'task'),
      ],
      { label: 'EigenMesh rebuild', entityType: 'initiative' },
    )
    runBoundedDecisionsMock.mockResolvedValue(jevMap([['hub-0', jevAnswer('true', 0.9)]]))

    await expect(judgeGtdProjectHub('u1', 'hub-entity-rebuild')).resolves.toEqual({
      isGtdProject: true,
      canonicalLabel: 'EigenMesh rebuild',
    })

    expect(runBoundedDecisionsMock).toHaveBeenCalledTimes(1)
    expect(llmMock).not.toHaveBeenCalled()

    const call = runBoundedDecisionsMock.mock.calls[0][0]
    expect(call.userId).toBe('u1')
    expect(call.surface).toBe('gtd_judge')
    expect(call.specs).toHaveLength(1)
    expect(call.specs[0]).toMatchObject({
      decisionKind: 'gtd_promotion',
      id: 'hub-0',
      llmChoice: null,
    })
    expect(call.specs[0].question.instructions).toBe(
      'Is this hub a GTD body of work — a multi-step initiative the user is running — or not?',
    )
    expect(call.specs[0].question.criteria).toEqual({
      true: 'A multi-step initiative the user is actively running across multiple thoughts — a GTD body of work.',
      false:
        'Not a project: an ingredient, a person, a place, a product, a single one-off task, or merely a frequently co-mentioned concept.',
    })
    // Guardrail: linked-thought summaries and the hub label are the judge's INPUT.
    const state = JSON.parse(call.state)
    expect(state.hubs[0].label).toBe('EigenMesh rebuild')
    expect(state.hubs[0].entityType).toBe('initiative')
    for (const summary of summaries) {
      expect(state.hubs[0].linkedThoughtSummaries).toContain(summary)
    }
    expect(state.hubs[0].openTaskSummaries).toContain('Pick a release name')
  })

  it('ESCALATION — p=0.5 calls qwen once; qwen verdict and canonicalLabel win', async () => {
    countLinkedMock.mockResolvedValue(5)
    countOpenMock.mockResolvedValue(2)
    mockHubDb(
      [
        thoughtRow('Clear the inbox down to zero every evening', 'task'),
        thoughtRow('Set up newsletter filters', 'task'),
      ],
      { label: 'Inbox zero sprint', entityType: 'initiative' },
    )
    runBoundedDecisionsMock.mockResolvedValue(jevMap([['hub-0', jevAnswer('true', 0.5)]]))
    llmMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({ isGtdProject: false, canonicalLabel: 'Inbox Zero week' }),
          },
        },
      ],
    })

    await expect(judgeGtdProjectHub('u1', 'hub-entity-inbox')).resolves.toEqual({
      isGtdProject: false,
      canonicalLabel: 'Inbox Zero week',
    })
    expect(llmMock).toHaveBeenCalledTimes(1)
    expect(runBoundedDecisionsMock).toHaveBeenCalledTimes(1)
    // The escalation runs after the row is persisted — the captured spec
    // honestly records llmChoice=null; the qwen verdict still drove the result.
    expect(runBoundedDecisionsMock.mock.calls[0][0].specs[0].llmChoice).toBeNull()
  })

  it.each([0.4, 0.6])('ESCALATION — inclusive band edge p=%s escalates to qwen', async (pTrue) => {
    countLinkedMock.mockResolvedValue(3)
    countOpenMock.mockResolvedValue(1)
    mockHubDb([thoughtRow('Borderline initiative notes', 'task')], {
      label: 'Borderline hub',
      entityType: 'initiative',
    })
    runBoundedDecisionsMock.mockResolvedValue(jevMap([['hub-0', jevAnswer('true', pTrue)]]))
    llmMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({ isGtdProject: false, canonicalLabel: 'Borderline hub' }),
          },
        },
      ],
    })

    await expect(judgeGtdProjectHub('u1', 'hub-entity-borderline')).resolves.toEqual({
      isGtdProject: false,
      canonicalLabel: 'Borderline hub',
    })
    expect(llmMock).toHaveBeenCalledTimes(1)
  })

  it.each([0.39, 0.61])('Jev decides just outside the band p=%s — qwen not called', async (pTrue) => {
    countLinkedMock.mockResolvedValue(3)
    countOpenMock.mockResolvedValue(1)
    mockHubDb([thoughtRow('Borderline initiative notes', 'task')], {
      label: 'Borderline hub',
      entityType: 'initiative',
    })
    const choice = pTrue < 0.5 ? 'false' : 'true'
    runBoundedDecisionsMock.mockResolvedValue(jevMap([['hub-0', jevAnswer(choice, pTrue)]]))

    await expect(judgeGtdProjectHub('u1', 'hub-entity-borderline')).resolves.toEqual({
      isGtdProject: choice === 'true',
      canonicalLabel: 'Borderline hub',
    })
    expect(llmMock).not.toHaveBeenCalled()
  })
})

describe('auditGtdProjectProfiles — gtd_promotion enforced (Jev)', () => {
  const negativeHubs = [
    {
      id: 'hub-entity-garlic',
      label: 'Roasted garlic',
      entityType: 'ingredient',
      thought: 'Roast the garlic slowly for the Sunday ragu',
    },
    {
      id: 'hub-entity-schwester',
      label: 'Schwester',
      entityType: 'person',
      thought: 'Schwester called about Omas Geburtstag',
    },
    {
      id: 'hub-entity-tax',
      label: 'Tax filing 2025',
      entityType: 'task',
      thought: 'Submit the 2025 tax filing, then done',
    },
    {
      id: 'hub-entity-eu',
      label: 'EU',
      entityType: 'concept',
      thought: 'The EU AI Act came up in the newsletter again',
    },
  ]
  const positiveHub = {
    id: 'hub-entity-rebuild',
    label: 'EigenMesh rebuild',
    entityType: 'initiative',
    thought: 'Ship the bounded decision plane',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resolveEnforceKindsMock.mockReturnValue(new Set(['gtd_promotion']))
    countLinkedMock.mockResolvedValue(3)
    countOpenMock.mockResolvedValue(1)
    demoteMock.mockResolvedValue(true)
    restoreMock.mockResolvedValue(undefined)
    decryptMock.mockResolvedValue('plain')
  })

  it('NEGATIVE — demotes every Jev-negative hub, keeps the positive, qwen never called', async () => {
    mockAuditHubDb([...negativeHubs, positiveHub])
    runBoundedDecisionsMock.mockResolvedValue(
      jevMap([
        ...negativeHubs.map((hub, index) => [`hub-${index}`, jevAnswer('false', 0.05)] as const),
        ['hub-4', jevAnswer('true', 0.9)] as const,
      ]),
    )

    await expect(auditGtdProjectProfiles('u1')).resolves.toEqual({ demoted: 4 })
    expect(demoteMock).toHaveBeenCalledTimes(4)
    for (const hub of negativeHubs) {
      expect(demoteMock).toHaveBeenCalledWith('u1', hub.id)
    }
    expect(llmMock).not.toHaveBeenCalled()
    // 4 demoted of 5 capture projects — not all, so no rollback.
    expect(restoreMock).not.toHaveBeenCalled()

    // One batched call: one bounded question per hub, ids hub-0..hub-4.
    const call = runBoundedDecisionsMock.mock.calls[0][0]
    expect(call.surface).toBe('gtd_judge')
    expect(call.specs.map((spec: { id: string }) => spec.id)).toEqual([
      'hub-0',
      'hub-1',
      'hub-2',
      'hub-3',
      'hub-4',
    ])
    expect(
      call.specs.every(
        (spec: { decisionKind: string; llmChoice: unknown }) =>
          spec.decisionKind === 'gtd_promotion' && spec.llmChoice === null,
      ),
    ).toBe(true)
    const state = JSON.parse(call.state)
    expect(state.hubs.map((hub: { label: string }) => hub.label)).toEqual([
      'Roasted garlic',
      'Schwester',
      'Tax filing 2025',
      'EU',
      'EigenMesh rebuild',
    ])
  })

  it('ESCALATION — a band hub escalates to qwen and its verdict drives the demote', async () => {
    mockAuditHubDb([
      {
        id: 'hub-entity-inbox',
        label: 'Inbox zero sprint',
        entityType: 'initiative',
        thought: 'Clear the inbox every evening this week',
      },
      positiveHub,
    ])
    runBoundedDecisionsMock.mockResolvedValue(
      jevMap([
        ['hub-0', jevAnswer('true', 0.5)] as const,
        ['hub-1', jevAnswer('true', 0.9)] as const,
      ]),
    )
    llmMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({ isGtdProject: false, canonicalLabel: 'Inbox zero sprint' }),
          },
        },
      ],
    })

    await expect(auditGtdProjectProfiles('u1')).resolves.toEqual({ demoted: 1 })
    expect(demoteMock).toHaveBeenCalledTimes(1)
    expect(demoteMock).toHaveBeenCalledWith('u1', 'hub-entity-inbox')
    expect(llmMock).toHaveBeenCalledTimes(1)
    expect(restoreMock).not.toHaveBeenCalled()
  })
})

describe('gtd_promotion not enforced — qwen behavior unchanged', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveEnforceKindsMock.mockReturnValue(new Set())
    countLinkedMock.mockResolvedValue(3)
    countOpenMock.mockResolvedValue(1)
    demoteMock.mockResolvedValue(true)
    restoreMock.mockResolvedValue(undefined)
    decryptMock.mockResolvedValue('plain')
  })

  it('hub judge stays on qwen; decision helper never called', async () => {
    mockHubDb([thoughtRow('Build EigenMesh', 'task')])
    llmMock.mockResolvedValue({
      choices: [
        { message: { content: '```json\n{"isGtdProject":true,"canonicalLabel":"Eigen"}\n```' } },
      ],
    })
    await expect(judgeGtdProjectHub('u1', 'e1')).resolves.toEqual({
      isGtdProject: true,
      canonicalLabel: 'Eigen',
    })
    expect(runBoundedDecisionsMock).not.toHaveBeenCalled()
    expect(llmMock).toHaveBeenCalledTimes(1)
  })

  it('audit stays on the qwen batch; decision helper never called', async () => {
    mockAuditHubDb([
      { id: 'hub-entity-garlic', label: 'garlic', entityType: 'concept', thought: 'note' },
      { id: 'hub-entity-eigen', label: 'Eigen', entityType: 'organization', thought: 'Build EigenMesh' },
    ])
    llmMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              results: [
                { entityId: 'hub-entity-garlic', isGtdProject: false, canonicalLabel: 'garlic' },
                { entityId: 'hub-entity-eigen', isGtdProject: true, canonicalLabel: 'Eigen' },
              ],
            }),
          },
        },
      ],
    })
    await expect(auditGtdProjectProfiles('u1')).resolves.toEqual({ demoted: 1 })
    expect(runBoundedDecisionsMock).not.toHaveBeenCalled()
    expect(demoteMock).toHaveBeenCalledWith('u1', 'hub-entity-garlic')
  })

  it('evidence gate still skips any LLM spend before the enforced branch', async () => {
    countLinkedMock.mockResolvedValue(1)
    countOpenMock.mockResolvedValue(0)
    mockHubDb([thoughtRow('one plain note')])
    await expect(judgeGtdProjectHub('u1', 'e1')).resolves.toEqual({
      isGtdProject: false,
      canonicalLabel: 'Eigen',
    })
    expect(runBoundedDecisionsMock).not.toHaveBeenCalled()
    expect(llmMock).not.toHaveBeenCalled()
  })
})

describe('enforced gtd_promotion — failure contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveEnforceKindsMock.mockReturnValue(new Set(['gtd_promotion']))
    countLinkedMock.mockResolvedValue(3)
    countOpenMock.mockResolvedValue(1)
    demoteMock.mockResolvedValue(true)
    restoreMock.mockResolvedValue(undefined)
    decryptMock.mockResolvedValue('plain')
  })

  it('hub judge rejects when the decision helper rejects — no qwen fallback', async () => {
    mockHubDb([thoughtRow('Build EigenMesh', 'task')])
    runBoundedDecisionsMock.mockRejectedValue(new Error('decision plane down'))
    await expect(judgeGtdProjectHub('u1', 'e1')).rejects.toThrow('decision plane down')
    expect(llmMock).not.toHaveBeenCalled()
  })

  it('audit rejects and demotes nothing when the decision helper rejects', async () => {
    mockAuditHubDb([
      { id: 'hub-entity-garlic', label: 'garlic', entityType: 'concept', thought: 'note' },
    ])
    runBoundedDecisionsMock.mockRejectedValue(new Error('decision plane down'))
    await expect(auditGtdProjectProfiles('u1')).rejects.toThrow('decision plane down')
    expect(demoteMock).not.toHaveBeenCalled()
    expect(llmMock).not.toHaveBeenCalled()
  })
})
