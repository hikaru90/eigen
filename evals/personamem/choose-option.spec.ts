import { describe, expect, it, vi } from 'vitest'

vi.mock('$lib/server/llm/llm-client', () => ({ llmChatCompletion: vi.fn() }))

import { chooseOption } from './choose-option'

const messages = [
  { role: 'system' as const, content: 'sys' },
  { role: 'user' as const, content: 'q' },
]

describe('chooseOption', () => {
  it('returns the letter from a JSON response', async () => {
    const complete = vi.fn(async () => '{"letter":"C"}')
    await expect(chooseOption({ messages, complete })).resolves.toBe('C')
    expect(complete).toHaveBeenCalledTimes(1)
    expect(complete).toHaveBeenCalledWith(messages)
  })

  it('accepts a fenced JSON response', async () => {
    const complete = async () => '```json\n{"letter":"A"}\n```'
    await expect(chooseOption({ messages, complete })).resolves.toBe('A')
  })

  it('throws after exactly 3 attempts when the letter is outside A-D', async () => {
    const complete = vi.fn(async () => '{"letter":"E"}')
    await expect(chooseOption({ messages, complete })).rejects.toThrow(/3 attempts/)
    expect(complete).toHaveBeenCalledTimes(3)
  })

  it('does not extract a letter from free text', async () => {
    const complete = vi.fn(async () => 'Final Answer: B')
    await expect(chooseOption({ messages, complete })).rejects.toThrow()
    expect(complete).toHaveBeenCalledTimes(3)
  })

  it('succeeds when a later attempt is valid', async () => {
    const complete = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('{"letter":"Z"}')
      .mockResolvedValueOnce('{"letter":"D"}')
    await expect(chooseOption({ messages, complete })).resolves.toBe('D')
    expect(complete).toHaveBeenCalledTimes(2)
  })

  it('lets a transport failure propagate without re-asking', async () => {
    const complete = vi.fn(async () => {
      throw new Error('gateway down')
    })
    await expect(chooseOption({ messages, complete })).rejects.toThrow('gateway down')
    expect(complete).toHaveBeenCalledTimes(1)
  })
})
