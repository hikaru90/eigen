import { describe, expect, it } from 'vitest'
import { currentEvalChatModel, withEvalChatModel } from './eval-chat-model'

describe('eval chat model context', () => {
  it('is unset outside withEvalChatModel', () => {
    expect(currentEvalChatModel()).toBeUndefined()
  })

  it('exposes the model inside the callback, across awaits, and returns the result', async () => {
    const result = await withEvalChatModel('openai/gpt-4o-mini', async () => {
      await new Promise((resolve) => setTimeout(resolve, 1))
      expect(currentEvalChatModel()).toBe('openai/gpt-4o-mini')
      return 42
    })
    expect(result).toBe(42)
    expect(currentEvalChatModel()).toBeUndefined()
  })

  it('nested contexts shadow and restore', async () => {
    await withEvalChatModel('openai/gpt-4o-mini', async () => {
      await withEvalChatModel('deepseek/deepseek-v4.1-flash-1017', async () => {
        expect(currentEvalChatModel()).toBe('deepseek/deepseek-v4.1-flash-1017')
      })
      expect(currentEvalChatModel()).toBe('openai/gpt-4o-mini')
    })
  })

  it('parallel contexts stay isolated', async () => {
    const seen = await Promise.all(
      ['openai/gpt-4o-mini', 'deepseek/deepseek-v4.1-flash-1017'].map((model) =>
        withEvalChatModel(model, async () => {
          await new Promise((resolve) => setTimeout(resolve, 2))
          return currentEvalChatModel()
        }),
      ),
    )
    expect(seen).toEqual(['openai/gpt-4o-mini', 'deepseek/deepseek-v4.1-flash-1017'])
  })

  it('trims the model it stores', async () => {
    await withEvalChatModel('  openai/gpt-4o-mini ', async () => {
      expect(currentEvalChatModel()).toBe('openai/gpt-4o-mini')
    })
  })

  it('rejects blank or malformed models without running the callback', async () => {
    for (const bad of [
      '',
      '   ',
      'gpt-4o-mini',
      '/gpt-4o-mini',
      'openai/',
      'a/b/c',
      'open ai/gpt',
    ]) {
      let ran = false
      await expect(
        withEvalChatModel(bad, async () => {
          ran = true
        }),
      ).rejects.toThrow(/eval chat model/i)
      expect(ran).toBe(false)
    }
  })
})
