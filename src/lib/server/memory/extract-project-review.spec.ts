import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseProjectReviewPayload, extractProjectReview } from './extract-project-review'

const { llmChatCompletionMock } = vi.hoisted(() => ({
  llmChatCompletionMock: vi.fn(),
}))

vi.mock('$lib/server/llm/llm-client', () => ({
  llmChatCompletion: llmChatCompletionMock,
}))

function makeResponse(content: string) {
  return { choices: [{ message: { content } }] }
}

describe('parseProjectReviewPayload', () => {
  const allowed = new Set(['t1', 't2', 't3'])

  it('parses a valid review payload', () => {
    const parsed = parseProjectReviewPayload(
      {
        projectDeadline: '2026-12-01T00:00:00.000Z',
        taskReviews: [
          {
            thoughtId: 't1',
            suggestion: 'keep',
            deadline: '2026-08-01T00:00:00.000Z',
            reason: 'Still needed',
          },
          {
            thoughtId: 't2',
            suggestion: 'mark_done',
            deadline: null,
            reason: 'Already finished',
          },
          {
            thoughtId: 't3',
            suggestion: 'archive',
            deadline: null,
            reason: 'No longer relevant',
          },
        ],
        order: ['t1', 't3', 't2'],
        newTaskSuggestions: [
          {
            summary: 'Book venue',
            kind: 'deadline',
            suggestedStartAt: '2026-09-01T00:00:00.000Z',
            suggestedEndAt: '2026-09-02T00:00:00.000Z',
            reason: 'Gap in waterfall',
          },
        ],
        nextActionThoughtId: 't1',
        nextActionIsNewTaskIndex: null,
      },
      allowed,
    )

    expect(parsed.projectDeadline).toBe('2026-12-01T00:00:00.000Z')
    expect(parsed.taskReviews).toHaveLength(3)
    expect(parsed.taskReviews[0]).toMatchObject({
      thoughtId: 't1',
      suggestion: 'keep',
      deadline: '2026-08-01T00:00:00.000Z',
    })
    expect(parsed.order).toEqual(['t1', 't3', 't2'])
    expect(parsed.newTaskSuggestions).toHaveLength(1)
    expect(parsed.newTaskSuggestions[0]?.summary).toBe('Book venue')
    expect(parsed.nextActionThoughtId).toBe('t1')
    expect(parsed.nextActionIsNewTaskIndex).toBeNull()
  })

  it('drops invented thoughtIds from taskReviews and order', () => {
    const parsed = parseProjectReviewPayload(
      {
        projectDeadline: null,
        taskReviews: [
          { thoughtId: 't1', suggestion: 'keep', deadline: null, reason: 'ok' },
          { thoughtId: 'foreign', suggestion: 'archive', deadline: null, reason: 'invented' },
        ],
        order: ['foreign', 't1', 'also-fake'],
        newTaskSuggestions: [],
        nextActionThoughtId: 'foreign',
        nextActionIsNewTaskIndex: null,
      },
      allowed,
    )

    expect(parsed.taskReviews).toEqual([
      { thoughtId: 't1', suggestion: 'keep', deadline: null, reason: 'ok' },
    ])
    expect(parsed.order).toEqual(['t1'])
    expect(parsed.nextActionThoughtId).toBeNull()
  })

  it('drops taskReviews with invalid suggestion enum', () => {
    const parsed = parseProjectReviewPayload(
      {
        taskReviews: [
          { thoughtId: 't1', suggestion: 'delete_forever', deadline: null, reason: 'bad' },
          { thoughtId: 't2', suggestion: 'keep', deadline: null, reason: 'ok' },
        ],
        order: ['t2'],
        newTaskSuggestions: [],
      },
      allowed,
    )
    expect(parsed.taskReviews).toEqual([
      { thoughtId: 't2', suggestion: 'keep', deadline: null, reason: 'ok' },
    ])
  })

  it('nulls invalid projectDeadline and task deadline ISO values', () => {
    const parsed = parseProjectReviewPayload(
      {
        projectDeadline: 'not-a-date',
        taskReviews: [{ thoughtId: 't1', suggestion: 'keep', deadline: 'also-bad', reason: 'x' }],
        order: ['t1'],
        newTaskSuggestions: [],
      },
      allowed,
    )
    expect(parsed.projectDeadline).toBeNull()
    expect(parsed.taskReviews[0]?.deadline).toBeNull()
  })

  it('nulls invalid kind on new task suggestions and drops empty summaries', () => {
    const parsed = parseProjectReviewPayload(
      {
        taskReviews: [],
        order: [],
        newTaskSuggestions: [
          { summary: '  ', kind: 'deadline', reason: 'empty' },
          {
            summary: 'Call vendor',
            kind: 'not-a-kind',
            suggested_start_at: '2026-07-01T00:00:00.000Z',
            reason: 'gap',
          },
        ],
        next_action_is_new_task_index: 0,
      },
      allowed,
    )
    expect(parsed.newTaskSuggestions).toEqual([
      {
        summary: 'Call vendor',
        kind: null,
        suggestedStartAt: '2026-07-01T00:00:00.000Z',
        suggestedEndAt: null,
        reason: 'gap',
      },
    ])
    expect(parsed.nextActionIsNewTaskIndex).toBe(0)
  })

  it('accepts snake_case keys', () => {
    const parsed = parseProjectReviewPayload(
      {
        project_deadline: '2026-11-01T00:00:00.000Z',
        task_reviews: [{ thought_id: 't1', suggestion: 'keep', deadline: null, reason: 'ok' }],
        order: ['t1'],
        new_task_suggestions: [{ summary: 'Ship', kind: null, reason: 'gap' }],
        next_action_thought_id: 't1',
        next_action_is_new_task_index: null,
      },
      allowed,
    )
    expect(parsed.projectDeadline).toBe('2026-11-01T00:00:00.000Z')
    expect(parsed.taskReviews[0]?.thoughtId).toBe('t1')
    expect(parsed.newTaskSuggestions[0]?.summary).toBe('Ship')
    expect(parsed.nextActionThoughtId).toBe('t1')
  })

  it('returns empty shape for non-object input', () => {
    expect(parseProjectReviewPayload(null, allowed)).toEqual({
      projectDeadline: null,
      taskReviews: [],
      order: [],
      newTaskSuggestions: [],
      nextActionThoughtId: null,
      nextActionIsNewTaskIndex: null,
    })
  })
})

describe('extractProjectReview', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns validated review from LLM JSON', async () => {
    llmChatCompletionMock.mockResolvedValue(
      makeResponse(
        JSON.stringify({
          projectDeadline: '2026-10-01T00:00:00.000Z',
          taskReviews: [
            { thoughtId: 't1', suggestion: 'keep', deadline: null, reason: 'Still open' },
          ],
          order: ['t1'],
          newTaskSuggestions: [],
          nextActionThoughtId: 't1',
          nextActionIsNewTaskIndex: null,
        }),
      ),
    )

    const result = await extractProjectReview({
      userId: 'u1',
      projectLabel: 'Launch',
      tasks: [
        {
          thoughtId: 't1',
          summary: 'Draft outline',
          rank: 1,
          status: 'open',
          deadline: null,
          isNextAction: true,
        },
      ],
      linkedThoughts: [{ thoughtId: 'n1', summary: 'Context note' }],
      projectDeadline: null,
    })

    expect(result.projectDeadline).toBe('2026-10-01T00:00:00.000Z')
    expect(result.taskReviews).toHaveLength(1)
    expect(result.nextActionThoughtId).toBe('t1')
    expect(llmChatCompletionMock).toHaveBeenCalled()
  })
})
