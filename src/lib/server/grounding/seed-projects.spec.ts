import { beforeEach, describe, expect, it, vi } from 'vitest'
import { extractProjectsFromGroundingFacet, parseProjectsPayload } from './seed-projects'

const { llmChatCompletionMock, getDbMock, upsertEntityNodeMock, captureThoughtMock } = vi.hoisted(
  () => ({
    llmChatCompletionMock: vi.fn(),
    getDbMock: vi.fn(),
    upsertEntityNodeMock: vi.fn(async () => undefined),
    captureThoughtMock: vi.fn(async () => ({ id: 'thought-1' })),
  }),
)

vi.mock('$lib/server/llm/llm-client', () => ({
  llmChatCompletion: llmChatCompletionMock,
}))

vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))

vi.mock('$lib/server/graph/age', () => ({
  upsertEntityNode: upsertEntityNodeMock,
}))

vi.mock('$lib/server/capture/service', () => ({
  captureThought: captureThoughtMock,
}))

vi.mock('$lib/server/memory/project-next-action', () => ({
  designateNextAction: vi.fn(async () => undefined),
}))

vi.mock('$lib/server/memory/project-list', () => ({
  ensureProjectProfile: vi.fn(async () => undefined),
}))

function makeResponse(content: string) {
  return { choices: [{ message: { content } }] }
}

describe('seed-projects', () => {
  beforeEach(() => vi.clearAllMocks())

  it('parseProjectsPayload normalizes project rows', () => {
    expect(
      parseProjectsPayload({
        projects: [{ name: 'Eigen Mesh', nextActionText: 'Ship header', status: 'active' }],
      }),
    ).toEqual([{ name: 'Eigen Mesh', nextActionText: 'Ship header', status: 'active' }])
  })

  it('extractProjectsFromGroundingFacet calls LLM with facet text', async () => {
    llmChatCompletionMock.mockResolvedValue(
      makeResponse(
        JSON.stringify({
          projects: [{ name: 'Eigen Mesh', nextActionText: 'Call Marcus', status: 'active' }],
        }),
      ),
    )

    const projects = await extractProjectsFromGroundingFacet(
      'u1',
      'Working on Eigen Mesh. Next: call Marcus.',
    )
    expect(projects).toHaveLength(1)
    expect(projects[0]?.name).toBe('Eigen Mesh')
  })
})
