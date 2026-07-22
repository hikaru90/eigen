import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  detectAndCreateProjectFromThought,
  detectProjectFromThought,
} from './detect-project-from-thought'

const { llmMock, promoteMock, resolveIdentityMock, linkMock } = vi.hoisted(() => ({
  llmMock: vi.fn(),
  promoteMock: vi.fn(),
  resolveIdentityMock: vi.fn(),
  linkMock: vi.fn(),
}))

vi.mock('$lib/server/llm/llm-client', () => ({
  llmChatCompletion: llmMock,
}))

vi.mock('$lib/server/memory/maybe-promote-gtd-project', () => ({
  promoteEntityToProject: promoteMock,
}))

vi.mock('$lib/server/memory/resolve-project-identity', () => ({
  resolveProjectIdentity: resolveIdentityMock,
}))

vi.mock('$lib/server/memory/project-next-action', () => ({
  linkThoughtToProject: linkMock,
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
    expect(linkMock).toHaveBeenCalledWith('u1', 'e9', 't1', 'ingest')
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
      forceJudge: false,
    })
    expect(linkMock).toHaveBeenCalledWith('u1', 'e-new', 't1', 'ingest')
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
