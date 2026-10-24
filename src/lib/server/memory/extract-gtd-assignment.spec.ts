import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyGtdAssignment, extractGtdAssignment, parseGtdAssignmentPayload } from './extract-gtd-assignment'

const {
  llmChatCompletionMock,
  getDbMock,
  decryptTenantValueMock,
  listEligibleProjectsForAssignmentMock,
  linkThoughtToProjectMock,
  designateNextActionMock,
  thoughtHasManualProjectLinkMock,
} = vi.hoisted(() => ({
  llmChatCompletionMock: vi.fn(),
  getDbMock: vi.fn(),
  decryptTenantValueMock: vi.fn(),
  listEligibleProjectsForAssignmentMock: vi.fn(),
  linkThoughtToProjectMock: vi.fn(),
  designateNextActionMock: vi.fn(),
  thoughtHasManualProjectLinkMock: vi.fn(),
}))

vi.mock('$lib/server/llm/llm-client', () => ({
  llmChatCompletion: llmChatCompletionMock,
}))

vi.mock('$lib/server/memory/project-next-action', () => ({
  linkThoughtToProject: linkThoughtToProjectMock,
  designateNextAction: designateNextActionMock,
  thoughtHasManualProjectLink: thoughtHasManualProjectLinkMock,
}))

vi.mock('$lib/server/memory/project-list', () => ({
  listEligibleProjectsForAssignment: listEligibleProjectsForAssignmentMock,
}))

vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))

vi.mock('$lib/server/crypto/tenant-encryption', () => ({
  decryptTenantValue: decryptTenantValueMock,
}))

function makeResponse(content: string) {
  return { choices: [{ message: { content } }] }
}

/** Chainable select-step for the single thought-row lookup (.from/.where/.limit). */
function makeDb(rows: unknown[]) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => rows),
        })),
      })),
    })),
  }
}

describe('extractGtdAssignment', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects project ids not in the catalog', () => {
    const allowed = new Set(['p1'])
    expect(
      parseGtdAssignmentPayload({ projectEntityId: 'other-id', isNextAction: true }, allowed),
    ).toEqual({ projectEntityId: null, isNextAction: true })
  })

  it('parses valid project assignment from LLM JSON', async () => {
    llmChatCompletionMock.mockResolvedValue(
      makeResponse(
        JSON.stringify({
          projectEntityId: 'p1',
          isNextAction: true,
        }),
      ),
    )

    const result = await extractGtdAssignment({
      userId: 'u1',
      normalizedText: 'Call Marcus about the proposal',
      projects: [{ entityId: 'p1', label: 'Eigen Mesh', status: 'active' }],
    })

    expect(result).toEqual({ projectEntityId: 'p1', isNextAction: true })
  })
})

describe('applyGtdAssignment open_loop eligibility gate', () => {
  const baseInput = {
    userId: 'u1',
    thoughtId: 't1',
    normalizedText: 'Call Marcus about the proposal',
    category: 'task',
  }
  const assignmentResult = { projectEntityId: 'p1', projectLabel: 'Eigen Mesh', isNextAction: false }

  beforeEach(() => {
    vi.clearAllMocks()
    thoughtHasManualProjectLinkMock.mockResolvedValue(false)
    listEligibleProjectsForAssignmentMock.mockResolvedValue([
      { entityId: 'p1', label: 'Eigen Mesh', status: 'active' },
    ])
    llmChatCompletionMock.mockResolvedValue(
      makeResponse(JSON.stringify({ projectEntityId: 'p1', isNextAction: false })),
    )
    linkThoughtToProjectMock.mockResolvedValue(undefined)
    designateNextActionMock.mockResolvedValue(undefined)
  })

  it('openLoop "mentioned" in encrypted metadata: not eligible — no assignment call, no link', async () => {
    getDbMock.mockReturnValue(
      makeDb([{ metadata: null, metadataEncrypted: 'enc:{"openLoop":"mentioned"}' }]),
    )
    decryptTenantValueMock.mockImplementation(async ({ ciphertext }: { ciphertext: string }) =>
      ciphertext.startsWith('enc:') ? ciphertext.slice(4) : ciphertext,
    )

    const result = await applyGtdAssignment(baseInput)

    expect(result).toBeNull()
    expect(decryptTenantValueMock).toHaveBeenCalledWith(
      expect.objectContaining({ table: 'thought', column: 'metadata', ciphertext: 'enc:{"openLoop":"mentioned"}' }),
    )
    expect(llmChatCompletionMock).not.toHaveBeenCalled()
    expect(linkThoughtToProjectMock).not.toHaveBeenCalled()
    expect(designateNextActionMock).not.toHaveBeenCalled()
  })

  it('openLoop "closed" in plain metadata: not eligible — no assignment call', async () => {
    getDbMock.mockReturnValue(makeDb([{ metadata: { openLoop: 'closed' }, metadataEncrypted: null }]))

    const result = await applyGtdAssignment(baseInput)

    expect(result).toBeNull()
    expect(decryptTenantValueMock).not.toHaveBeenCalled()
    expect(llmChatCompletionMock).not.toHaveBeenCalled()
    expect(linkThoughtToProjectMock).not.toHaveBeenCalled()
  })

  it('openLoop "actionable": assignment runs as today', async () => {
    getDbMock.mockReturnValue(
      makeDb([{ metadata: null, metadataEncrypted: 'enc:{"openLoop":"actionable"}' }]),
    )
    decryptTenantValueMock.mockImplementation(async ({ ciphertext }: { ciphertext: string }) =>
      ciphertext.startsWith('enc:') ? ciphertext.slice(4) : ciphertext,
    )

    const result = await applyGtdAssignment(baseInput)

    expect(result).toEqual(assignmentResult)
    expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
    expect(linkThoughtToProjectMock).toHaveBeenCalledWith('u1', 'p1', 't1', 'project')
  })

  it('openLoop absent (legacy thought): assignment runs as today', async () => {
    getDbMock.mockReturnValue(
      makeDb([{ metadata: { categorySource: 'llm' }, metadataEncrypted: null }]),
    )

    const result = await applyGtdAssignment(baseInput)

    expect(result).toEqual(assignmentResult)
    expect(decryptTenantValueMock).not.toHaveBeenCalled()
    expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
    expect(linkThoughtToProjectMock).toHaveBeenCalledWith('u1', 'p1', 't1', 'project')
  })

  it('thought row missing: eligibility defaults to eligible (assignment runs as today)', async () => {
    getDbMock.mockReturnValue(makeDb([]))

    const result = await applyGtdAssignment(baseInput)

    expect(result).toEqual(assignmentResult)
    expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
  })
})
