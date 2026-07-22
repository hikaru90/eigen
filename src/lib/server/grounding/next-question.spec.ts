import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateGroundingQuestion } from '$lib/server/grounding/next-question'

const { llmChatCompletionMock, loadGroundingProfileRowMock, loadRecentThoughtsMock } = vi.hoisted(
  () => ({
    llmChatCompletionMock: vi.fn(),
    loadGroundingProfileRowMock: vi.fn(),
    loadRecentThoughtsMock: vi.fn(),
  }),
)

vi.mock('$lib/server/llm/llm-client', () => ({
  llmChatCompletion: llmChatCompletionMock,
}))

vi.mock('$lib/server/grounding/profile', () => ({
  loadGroundingProfileRow: loadGroundingProfileRowMock,
}))

vi.mock('$lib/server/grounding/question-due', () => ({
  loadRecentThoughtsForGroundingQuestion: loadRecentThoughtsMock,
}))

describe('generateGroundingQuestion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadGroundingProfileRowMock.mockResolvedValue({ facets: {}, narrativeSummary: '' })
    loadRecentThoughtsMock.mockResolvedValue([
      { normalizedText: 'Working on SPACE Hamburg launch', category: 'project' },
    ])
  })

  it('returns approved template question, not free-form LLM copy', async () => {
    llmChatCompletionMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              templateId: 'work_where',
              anchor: 'SPACE',
            }),
          },
        },
      ],
    })

    const result = await generateGroundingQuestion('u1')
    expect(result).toEqual({
      facetKey: 'work',
      question: 'You mention SPACE a lot — is that where you work?',
    })
  })

  it('returns null when LLM skips', async () => {
    llmChatCompletionMock.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ skip: true }) } }],
    })

    expect(await generateGroundingQuestion('u1')).toBeNull()
  })

  it('returns null for invalid template ids', async () => {
    llmChatCompletionMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              templateId: 'name_origin_story',
              anchor: 'Alex',
            }),
          },
        },
      ],
    })

    expect(await generateGroundingQuestion('u1')).toBeNull()
  })

  it('returns null when anchored template has no anchor', async () => {
    llmChatCompletionMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({ templateId: 'self_name_disambiguation' }),
          },
        },
      ],
    })

    expect(await generateGroundingQuestion('u1')).toBeNull()
  })

  it('returns null for legacy free-form LLM question shape', async () => {
    llmChatCompletionMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              facetKey: 'identity',
              question:
                "What's the story behind your name Alex, and how has it shaped your relationships?",
            }),
          },
        },
      ],
    })

    expect(await generateGroundingQuestion('u1')).toBeNull()
  })
})
