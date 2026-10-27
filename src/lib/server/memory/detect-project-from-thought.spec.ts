import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  detectAndCreateProjectFromThought,
  detectProjectFromThought,
} from './detect-project-from-thought'

const {
  llmMock,
  promoteMock,
  resolveIdentityMock,
  linkMock,
  membershipMock,
  getDbMock,
  loadCtxMock,
  judgeMock,
  ensureMock,
  promoteTypeMock,
} = vi.hoisted(() => ({
  llmMock: vi.fn(),
  promoteMock: vi.fn(),
  resolveIdentityMock: vi.fn(),
  linkMock: vi.fn(),
  membershipMock: vi.fn(),
  getDbMock: vi.fn(),
  loadCtxMock: vi.fn(),
  judgeMock: vi.fn(),
  ensureMock: vi.fn(),
  promoteTypeMock: vi.fn(),
}))

vi.mock('$lib/server/llm/llm-client', () => ({
  llmChatCompletion: llmMock,
}))

vi.mock('$lib/server/memory/maybe-promote-gtd-project', () => ({
  promoteEntityToProject: promoteMock,
}))

// Boundaries under the real promoteEntityToProject (used by the first-mention block below):
// the hub context, the judge verdict and the persistence calls are fakes; the structural
// pre-check shouldInvokeGtdProjectJudge stays the REAL function so the test sees what
// production sees.
vi.mock('$lib/server/db', () => ({ getDb: getDbMock }))

vi.mock('$lib/server/memory/judge-gtd-project', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./judge-gtd-project')>()
  return {
    shouldInvokeGtdProjectJudge: actual.shouldInvokeGtdProjectJudge,
    loadHubJudgmentContext: loadCtxMock,
    judgeGtdProjectHub: judgeMock,
  }
})

// The unused exports exist only because the real shouldInvokeGtdProjectJudge is imported from
// judge-gtd-project, whose module scope references demoteProject.
vi.mock('$lib/server/memory/project-eligibility', () => ({
  ensureProject: ensureMock,
  countLinkedThoughtsForProjectEntity: vi.fn(),
  countOpenTasksForProjectEntity: vi.fn(),
  demoteProject: vi.fn(),
  restoreProjectListing: vi.fn(),
}))

vi.mock('$lib/server/memory/project-entity', () => ({ promoteHubEntityType: promoteTypeMock }))

vi.mock('$lib/server/memory/resolve-project-identity', () => ({
  resolveProjectIdentity: resolveIdentityMock,
}))

vi.mock('$lib/server/memory/project-next-action', () => ({
  linkThoughtToProject: linkMock,
}))

vi.mock('$lib/server/memory/project-membership', () => ({
  thoughtHasProjectMembership: membershipMock,
}))

vi.mock('$lib/paraglide/messages.js', () => ({
  m: {
    llm_project_detection_system: () => 'Detect projects.',
  },
}))

describe('detectProjectFromThought', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null project when LLM yields null label', async () => {
    llmMock.mockResolvedValue({
      choices: [{ message: { content: '{"projectLabel":null}' } }],
    })
    await expect(
      detectProjectFromThought({ userId: 'u1', normalizedText: 'buy milk' }),
    ).resolves.toEqual({ projectLabel: null })
  })

  it('returns project label from LLM JSON', async () => {
    llmMock.mockResolvedValue({
      choices: [{ message: { content: '{"projectLabel":"EigenMesh"}' } }],
    })
    await expect(
      detectProjectFromThought({
        userId: 'u1',
        normalizedText: 'Working on EigenMesh MVP',
      }),
    ).resolves.toEqual({ projectLabel: 'EigenMesh' })
  })

  it('throws when LLM content is missing', async () => {
    llmMock.mockResolvedValue({ choices: [{}] })
    await expect(detectProjectFromThought({ userId: 'u1', normalizedText: 'x' })).rejects.toThrow(
      /missing LLM content/,
    )
  })
})

describe('detectAndCreateProjectFromThought', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    membershipMock.mockResolvedValue(false)
    promoteMock.mockResolvedValue(true)
    linkMock.mockResolvedValue(undefined)
    llmMock.mockResolvedValue({
      choices: [{ message: { content: '{"projectLabel":"EigenMesh"}' } }],
    })
    resolveIdentityMock.mockResolvedValue({
      entityId: 'e-new',
      canonicalLabel: 'EigenMesh',
      hubEntityType: 'project',
      isGtdProject: false,
      shouldCreateHub: true,
      mergeEntityIds: [],
    })
  })

  it('returns null when no project detected', async () => {
    llmMock.mockResolvedValue({
      choices: [{ message: { content: '{"projectLabel":null}' } }],
    })
    await expect(
      detectAndCreateProjectFromThought({ userId: 'u1', normalizedText: 'buy milk' }),
    ).resolves.toBeNull()
    expect(resolveIdentityMock).not.toHaveBeenCalled()
  })

  it('links via resolveProjectIdentity when identity returns an existing GTD project', async () => {
    resolveIdentityMock.mockResolvedValue({
      entityId: 'e9',
      canonicalLabel: 'EigenMesh',
      hubEntityType: 'project',
      isGtdProject: true,
      shouldCreateHub: false,
      mergeEntityIds: [],
    })
    await expect(
      detectAndCreateProjectFromThought({
        userId: 'u1',
        normalizedText: 'Working on EigenMesh',
        thoughtId: 't1',
      }),
    ).resolves.toBe('e9')
    expect(resolveIdentityMock).toHaveBeenCalledWith({
      userId: 'u1',
      surfaceLabel: 'EigenMesh',
      thoughtId: 't1',
      mode: 'assign',
    })
    expect(linkMock).toHaveBeenCalledWith('u1', 'e9', 't1', 'project')
    expect(promoteMock).not.toHaveBeenCalled()
  })

  it('promotes and links when identity creates a new hub', async () => {
    await expect(
      detectAndCreateProjectFromThought({
        userId: 'u1',
        normalizedText: 'Working on EigenMesh',
        thoughtId: 't1',
      }),
    ).resolves.toBe('e-new')
    expect(resolveIdentityMock).toHaveBeenCalledWith({
      userId: 'u1',
      surfaceLabel: 'EigenMesh',
      thoughtId: 't1',
      mode: 'assign',
    })
    expect(promoteMock).toHaveBeenCalledWith({
      userId: 'u1',
      entityId: 'e-new',
      source: 'capture',
      forceJudge: true,
    })
    expect(linkMock).toHaveBeenCalledWith('u1', 'e-new', 't1', 'project')
  })

  it('skips entirely when the thought already belongs to a thread — the explicit pick or earlier decision wins, never a second membership', async () => {
    membershipMock.mockResolvedValue(true)
    await expect(
      detectAndCreateProjectFromThought({
        userId: 'u1',
        normalizedText: 'Working on EigenMesh',
        thoughtId: 't1',
      }),
    ).resolves.toBeNull()
    // no LLM detection cost, no identity binding, no link, no promotion
    expect(llmMock).not.toHaveBeenCalled()
    expect(resolveIdentityMock).not.toHaveBeenCalled()
    expect(linkMock).not.toHaveBeenCalled()
    expect(promoteMock).not.toHaveBeenCalled()
  })

  it('returns null when judge rejects promotion of a new hub', async () => {
    promoteMock.mockResolvedValue(false)
    await expect(
      detectAndCreateProjectFromThought({
        userId: 'u1',
        normalizedText: 'Working on EigenMesh',
      }),
    ).resolves.toBeNull()
  })

  it('does not substring-bind roasted garlic to an unrelated EigenMesh project', async () => {
    llmMock.mockResolvedValue({
      choices: [{ message: { content: '{"projectLabel":"roasted garlic"}' } }],
    })
    // Identity LLM keeps ingredients separate — new hub, not EigenMesh
    resolveIdentityMock.mockResolvedValue({
      entityId: 'e-garlic',
      canonicalLabel: 'roasted garlic',
      hubEntityType: 'other',
      isGtdProject: false,
      shouldCreateHub: true,
      mergeEntityIds: [],
    })
    promoteMock.mockResolvedValue(false)

    await expect(
      detectAndCreateProjectFromThought({
        userId: 'u1',
        normalizedText: 'Need roasted garlic for dinner',
        thoughtId: 't1',
      }),
    ).resolves.toBeNull()

    expect(resolveIdentityMock).toHaveBeenCalledWith(
      expect.objectContaining({ surfaceLabel: 'roasted garlic' }),
    )
    expect(linkMock).not.toHaveBeenCalledWith(
      'u1',
      'e-eigenmesh',
      expect.anything(),
      expect.anything(),
    )
  })

  it('does not substring-bind a relative name to an unrelated project', async () => {
    llmMock.mockResolvedValue({
      choices: [{ message: { content: '{"projectLabel":"schwester"}' } }],
    })
    resolveIdentityMock.mockResolvedValue({
      entityId: 'e-schwester',
      canonicalLabel: 'schwester',
      hubEntityType: 'person',
      isGtdProject: false,
      shouldCreateHub: true,
      mergeEntityIds: [],
    })
    promoteMock.mockResolvedValue(false)

    await expect(
      detectAndCreateProjectFromThought({
        userId: 'u1',
        normalizedText: 'Call schwester tomorrow',
      }),
    ).resolves.toBeNull()

    expect(resolveIdentityMock).toHaveBeenCalledWith(
      expect.objectContaining({ surfaceLabel: 'schwester', mode: 'assign' }),
    )
  })

  it('does not substring-bind a single task label to an existing project by name overlap', async () => {
    llmMock.mockResolvedValue({
      choices: [{ message: { content: '{"projectLabel":"Eigen"}' } }],
    })
    // Identity LLM must decide — not ".includes('eigen')" against "EigenMesh"
    resolveIdentityMock.mockResolvedValue({
      entityId: 'e-eigen-only',
      canonicalLabel: 'Eigen',
      hubEntityType: 'project',
      isGtdProject: false,
      shouldCreateHub: true,
      mergeEntityIds: [],
    })
    promoteMock.mockResolvedValue(false)

    await expect(
      detectAndCreateProjectFromThought({
        userId: 'u1',
        normalizedText: 'Fix Eigen typo',
        thoughtId: 't1',
      }),
    ).resolves.toBeNull()

    expect(resolveIdentityMock).toHaveBeenCalledWith(
      expect.objectContaining({ surfaceLabel: 'Eigen', mode: 'assign' }),
    )
    // Must not have linked to some EigenMesh id without LLM identity
    expect(linkMock).not.toHaveBeenCalled()
  })
})

/**
 * First mention of a project: the hub has 1 linked thought and 0 open tasks, so the structural
 * count pre-check (shouldInvokeGtdProjectJudge) would skip the judge. Detection already spent an
 * LLM call to name the project — the GTD LLM judge must always get to decide, and its verdict is
 * the only thing that promotes.
 */
describe('detectAndCreateProjectFromThought — first mention reaches the GTD judge', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  function hubIdentity(entityId: string, canonicalLabel: string, hubEntityType: string) {
    return {
      entityId,
      canonicalLabel,
      hubEntityType,
      isGtdProject: false,
      shouldCreateHub: true,
      mergeEntityIds: [],
    }
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    // The real promotion, over faked boundaries.
    const actual = await vi.importActual<typeof import('./maybe-promote-gtd-project')>(
      './maybe-promote-gtd-project',
    )
    promoteMock.mockImplementation(actual.promoteEntityToProject)

    const limit = vi.fn(async () => [])
    const where = vi.fn(() => ({ limit }))
    const from = vi.fn(() => ({ where }))
    const select = vi.fn(() => ({ from }))
    getDbMock.mockReturnValue({ select })

    membershipMock.mockResolvedValue(false)
    linkMock.mockResolvedValue(undefined)
    ensureMock.mockResolvedValue(undefined)
    promoteTypeMock.mockResolvedValue(undefined)
    // 1 linked thought (the one being captured), 0 open tasks: below every count threshold.
    loadCtxMock.mockResolvedValue({
      entityId: 'e-lisbon',
      label: 'Lisbon offsite',
      entityType: 'event',
      linkedThoughtCount: 1,
      openTaskCount: 0,
      linkedThoughtSummaries: ['Plan the Lisbon offsite for the team'],
      openTaskSummaries: [],
    })
    llmMock.mockResolvedValue({
      choices: [{ message: { content: '{"projectLabel":"Lisbon offsite"}' } }],
    })
    resolveIdentityMock.mockResolvedValue(hubIdentity('e-lisbon', 'Lisbon offsite', 'event'))
  })

  afterEach(() => {
    logSpy.mockRestore()
  })

  it('invokes the judge for a hub with 1 linked thought and 0 tasks, and promotes + links on yes', async () => {
    judgeMock.mockResolvedValue({ isGtdProject: true, canonicalLabel: 'Lisbon offsite' })

    await expect(
      detectAndCreateProjectFromThought({
        userId: 'u1',
        normalizedText: 'Plan the Lisbon offsite for the team',
        thoughtId: 't1',
      }),
    ).resolves.toBe('e-lisbon')

    expect(judgeMock).toHaveBeenCalledTimes(1)
    expect(judgeMock).toHaveBeenCalledWith('u1', 'e-lisbon', { force: true })
    expect(promoteTypeMock).toHaveBeenCalledWith('u1', 'e-lisbon', 'Lisbon offsite')
    expect(ensureMock).toHaveBeenCalledWith('u1', 'e-lisbon', 'active', 'capture')
    expect(linkMock).toHaveBeenCalledWith('u1', 'e-lisbon', 't1', 'project')
  })

  it('does not promote or link when the judge says no, and the log names the judge rejection', async () => {
    judgeMock.mockResolvedValue({ isGtdProject: false, canonicalLabel: 'Lisbon offsite' })

    await expect(
      detectAndCreateProjectFromThought({
        userId: 'u1',
        normalizedText: 'Plan the Lisbon offsite for the team',
        thoughtId: 't1',
      }),
    ).resolves.toBeNull()

    // the judge really ran — the rejection in the log is its verdict, not a skipped pre-check
    expect(judgeMock).toHaveBeenCalledTimes(1)
    expect(promoteTypeMock).not.toHaveBeenCalled()
    expect(ensureMock).not.toHaveBeenCalled()
    expect(linkMock).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith(
      '[project-detection] LLM judge rejected project promotion',
      expect.objectContaining({ entityId: 'e-lisbon', label: 'Lisbon offsite' }),
    )
  })

  it('does not invoke the judge when detection names no project', async () => {
    llmMock.mockResolvedValue({
      choices: [{ message: { content: '{"projectLabel":null}' } }],
    })

    await expect(
      detectAndCreateProjectFromThought({
        userId: 'u1',
        normalizedText: 'buy milk',
        thoughtId: 't1',
      }),
    ).resolves.toBeNull()

    expect(loadCtxMock).not.toHaveBeenCalled()
    expect(judgeMock).not.toHaveBeenCalled()
    expect(promoteMock).not.toHaveBeenCalled()
    expect(ensureMock).not.toHaveBeenCalled()
    expect(linkMock).not.toHaveBeenCalled()
  })

  it.each([
    ['roasted garlic', 'other', 'Need roasted garlic for dinner'],
    ['Schwester', 'person', 'Call Schwester tomorrow'],
  ])(
    'a detected %s is promoted only on a positive judge verdict — judge no keeps it out of Projects',
    async (label, hubEntityType, normalizedText) => {
      llmMock.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({ projectLabel: label }) } }],
      })
      resolveIdentityMock.mockResolvedValue(hubIdentity('e-hub', label, hubEntityType))
      loadCtxMock.mockResolvedValue({
        entityId: 'e-hub',
        label,
        entityType: hubEntityType,
        linkedThoughtCount: 1,
        openTaskCount: 0,
        linkedThoughtSummaries: [normalizedText],
        openTaskSummaries: [],
      })
      judgeMock.mockResolvedValue({ isGtdProject: false, canonicalLabel: label })

      await expect(
        detectAndCreateProjectFromThought({ userId: 'u1', normalizedText, thoughtId: 't1' }),
      ).resolves.toBeNull()

      expect(judgeMock).toHaveBeenCalledTimes(1)
      expect(promoteTypeMock).not.toHaveBeenCalled()
      expect(ensureMock).not.toHaveBeenCalled()
      expect(linkMock).not.toHaveBeenCalled()

      // Same hub, same counts, only the verdict flips: promotion follows the judge alone.
      judgeMock.mockResolvedValue({ isGtdProject: true, canonicalLabel: label })
      await expect(
        detectAndCreateProjectFromThought({ userId: 'u1', normalizedText, thoughtId: 't1' }),
      ).resolves.toBe('e-hub')
      expect(ensureMock).toHaveBeenCalledTimes(1)
      expect(linkMock).toHaveBeenCalledWith('u1', 'e-hub', 't1', 'project')
    },
  )
})
