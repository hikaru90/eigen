import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDbMock, llmMock, decryptMock, countLinkedMock, countOpenMock, demoteMock, restoreMock } =
  vi.hoisted(() => ({
    getDbMock: vi.fn(),
    llmMock: vi.fn(),
    decryptMock: vi.fn(),
    countLinkedMock: vi.fn(),
    countOpenMock: vi.fn(),
    demoteMock: vi.fn(),
    restoreMock: vi.fn(),
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

  function mockHubDb(thoughtRows: unknown[] = []) {
    let selectCall = 0
    getDbMock.mockReturnValue({
      select: vi.fn(() => {
        selectCall += 1
        if (selectCall === 1) {
          return {
            from: vi.fn(() =>
              makeFromChain({
                entityRows: [{ label: 'Eigen', entityType: 'organization' }],
              }),
            ),
          }
        }
        return {
          from: vi.fn(() => makeFromChain({ thoughtRows })),
        }
      }),
    })
  }

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
