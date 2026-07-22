import { describe, expect, it } from 'vitest'
import { persistStreamedAssistantTurn } from './handle-agent-chat-post'

describe('persistStreamedAssistantTurn', () => {
  it('inserts compacted tool steps before the final assistant text', async () => {
    const insertOrder: Array<{ content: string; metadata?: Record<string, unknown> | null }> = []

    const db = {
      insert: () => ({
        values: (row: {
          content: string
          metadata?: Record<string, unknown> | null
          role: string
        }) => {
          insertOrder.push({ content: row.content, metadata: row.metadata ?? null })
          return {
            returning: async () => [{ id: `id-${insertOrder.length}` }],
          }
        },
      }),
    }

    const result = await persistStreamedAssistantTurn({
      db: db as never,
      sessionId: 'sess-1',
      userId: 'user-1',
      responseText: 'Final answer',
      intermediateSteps: [
        {
          content: JSON.stringify({ tool: 'create_text_file', arguments: { title: 'list' } }),
          metadata: {
            variant: 'tool_call',
            tool: 'create_text_file',
            arguments: { title: 'list' },
          },
        },
        {
          content: 'create_text_file',
          metadata: { variant: 'tool_executing', tool: 'create_text_file' },
        },
        {
          content: 'Saving…',
          metadata: { variant: 'tool_progress', tool: 'create_text_file', label: 'Saving…' },
        },
        {
          content: '{"text_file_id":"n1"}',
          metadata: {
            variant: 'tool_result',
            tool: 'create_text_file',
            displaySummary: 'Created note',
          },
        },
      ],
    })

    expect(result.storedStepCount).toBe(1)
    expect(insertOrder).toHaveLength(2)
    expect(insertOrder[0].metadata?.variant).toBe('tool_step')
    expect(insertOrder[0].content).toBe('{"text_file_id":"n1"}')
    expect(insertOrder[1].content).toBe('Final answer')
    expect(insertOrder[1].metadata).toBeNull()
    expect(result.messageId).toBe('id-2')
  })
})
