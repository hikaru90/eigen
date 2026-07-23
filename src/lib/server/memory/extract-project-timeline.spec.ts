import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  parseProjectTimelinePayload,
  extractProjectTimeline,
} from './extract-project-timeline'

const { llmChatCompletionMock } = vi.hoisted(() => ({
  llmChatCompletionMock: vi.fn(),
}))

vi.mock('$lib/server/llm/llm-client', () => ({
  llmChatCompletion: llmChatCompletionMock,
}))

function makeResponse(content: string) {
  return { choices: [{ message: { content } }] }
}

describe('parseProjectTimelinePayload', () => {
  it('parses target date and milestones with allowed linked thoughts', () => {
    const parsed = parseProjectTimelinePayload(
      {
        targetDate: '2026-09-01T00:00:00.000Z',
        milestones: [
          {
            label: 'Beta ship',
            targetDate: '2026-08-01T00:00:00.000Z',
            linkedThoughtId: 't1',
          },
          { label: 'Ignored foreign', linkedThoughtId: 'foreign' },
          { label: '  ' },
        ],
      },
      new Set(['t1']),
    )
    expect(parsed.targetDate).toBe('2026-09-01T00:00:00.000Z')
    expect(parsed.milestones).toEqual([
      {
        label: 'Beta ship',
        targetDate: '2026-08-01T00:00:00.000Z',
        linkedThoughtId: 't1',
      },
    ])
  })

  it('nulls invalid targetDate and drops empty labels', () => {
    expect(
      parseProjectTimelinePayload(
        { targetDate: 'not-a-date', milestones: [{ label: '' }] },
        new Set(),
      ),
    ).toEqual({ targetDate: null, milestones: [] })
  })

  it('accepts snake_case keys', () => {
    const parsed = parseProjectTimelinePayload(
      {
        target_date: null,
        milestones: [{ label: 'Launch', target_date: '2026-12-01T00:00:00.000Z' }],
      },
      new Set(),
    )
    expect(parsed.targetDate).toBeNull()
    expect(parsed.milestones[0]?.targetDate).toBe('2026-12-01T00:00:00.000Z')
  })
})

describe('extractProjectTimeline', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns validated timeline from LLM JSON', async () => {
    llmChatCompletionMock.mockResolvedValue(
      makeResponse(
        JSON.stringify({
          targetDate: '2026-10-01T00:00:00.000Z',
          milestones: [{ label: 'Alpha', targetDate: '2026-08-15T00:00:00.000Z' }],
        }),
      ),
    )

    const result = await extractProjectTimeline({
      userId: 'u1',
      projectLabel: 'Eigen Mesh',
      linkedThoughts: [{ thoughtId: 't1', summary: 'Ship alpha' }],
      existingDeadlines: [{ thoughtId: 't1', summary: 'Alpha due', startAt: '2026-08-15T00:00:00.000Z' }],
    })

    expect(result.targetDate).toBe('2026-10-01T00:00:00.000Z')
    expect(result.milestones).toHaveLength(1)
    expect(result.milestones[0]?.label).toBe('Alpha')
  })
})
