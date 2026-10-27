import { beforeEach, describe, expect, it, vi } from 'vitest'
import { evaluateHubsForGtdPromotion } from './promote-eligible-project-hubs'

/**
 * Entity-graph path: the count pre-check (shouldInvokeGtdProjectJudge) stays a cost gate here —
 * without it the judge would run for every entity of every capture. Only an explicit
 * forceJudge (assign / seed / the detection path) bypasses it. Real promoteEntityToProject and
 * real shouldInvokeGtdProjectJudge; hub context, judge verdict and persistence are fakes.
 */
const { getDbMock, loadCtxMock, judgeMock, ensureMock, promoteTypeMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  loadCtxMock: vi.fn(),
  judgeMock: vi.fn(),
  ensureMock: vi.fn(),
  promoteTypeMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }))

vi.mock('$lib/server/memory/judge-gtd-project', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./judge-gtd-project')>()
  return {
    shouldInvokeGtdProjectJudge: actual.shouldInvokeGtdProjectJudge,
    loadHubJudgmentContext: loadCtxMock,
    judgeGtdProjectHub: judgeMock,
    auditGtdProjectProfiles: vi.fn(),
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

function hubContext(linkedThoughtCount: number, openTaskCount: number) {
  return {
    entityId: 'e1',
    label: 'Lisbon offsite',
    entityType: 'event',
    linkedThoughtCount,
    openTaskCount,
    linkedThoughtSummaries: [],
    openTaskSummaries: [],
  }
}

describe('evaluateHubsForGtdPromotion — structural pre-check stays on the entity-graph path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // First select: the hub rows for the eval; every later select: "no project_status yet".
    const hubRows = vi.fn(async () => [{ id: 'e1' }])
    const noProject = vi.fn(async () => [])
    getDbMock.mockReturnValue({
      select: vi
        .fn()
        .mockReturnValueOnce({ from: () => ({ where: hubRows }) })
        .mockReturnValue({ from: () => ({ where: () => ({ limit: noProject }) }) }),
    })
    ensureMock.mockResolvedValue(undefined)
    promoteTypeMock.mockResolvedValue(undefined)
    judgeMock.mockResolvedValue({ isGtdProject: true, canonicalLabel: 'Lisbon offsite' })
  })

  it('does not call the judge for a hub with 1 linked thought and 0 tasks (no forceJudge)', async () => {
    loadCtxMock.mockResolvedValue(hubContext(1, 0))

    await expect(evaluateHubsForGtdPromotion('u1', ['e1'])).resolves.toBe(0)

    expect(judgeMock).not.toHaveBeenCalled()
    expect(ensureMock).not.toHaveBeenCalled()
  })

  it('calls the judge once the counts pass the pre-check (3 linked thoughts)', async () => {
    loadCtxMock.mockResolvedValue(hubContext(3, 0))

    await expect(evaluateHubsForGtdPromotion('u1', ['e1'])).resolves.toBe(1)

    expect(judgeMock).toHaveBeenCalledWith('u1', 'e1', { force: undefined })
  })

  it('an explicit forceJudge still bypasses the pre-check', async () => {
    loadCtxMock.mockResolvedValue(hubContext(1, 0))

    await expect(evaluateHubsForGtdPromotion('u1', ['e1'], { forceJudge: true })).resolves.toBe(1)

    expect(judgeMock).toHaveBeenCalledWith('u1', 'e1', { force: true })
  })
})
