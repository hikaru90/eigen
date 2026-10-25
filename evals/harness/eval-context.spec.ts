import { describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  release: vi.fn(),
  reserve: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({
  appSql: { reserve: m.reserve },
  createScopedDrizzle: () => ({ scoped: true }),
  appDbAsyncLocal: { run: (_db: unknown, fn: () => unknown) => fn() },
  appReservedSqlAsyncLocal: { run: (_r: unknown, fn: () => unknown) => fn() },
  activateTenantDbSession: vi.fn(),
  deactivateTenantDbSession: vi.fn(async () => {}),
}))

import { currentEvalChatModel } from '$lib/server/llm/eval-chat-model'
import { withEvalDb } from './eval-context'

describe('withEvalDb chatModel', () => {
  it('runs the callback (and everything it awaits) under the eval chat model', async () => {
    m.reserve.mockResolvedValue({ release: m.release })
    const seen = await withEvalDb(
      'public-bench-x',
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 1))
        const workers = await Promise.all(
          [0, 1].map(async () => {
            await new Promise((resolve) => setTimeout(resolve, 1))
            return currentEvalChatModel()
          }),
        )
        return [currentEvalChatModel(), ...workers]
      },
      { billingUserId: 'public-bench-runner', chatModel: 'openai/gpt-4o-mini' },
    )
    expect(seen).toEqual(['openai/gpt-4o-mini', 'openai/gpt-4o-mini', 'openai/gpt-4o-mini'])
    expect(currentEvalChatModel()).toBeUndefined()
  })

  it('leaves the model unset without the option', async () => {
    m.reserve.mockResolvedValue({ release: m.release })
    const seen = await withEvalDb('public-bench-x', async () => currentEvalChatModel())
    expect(seen).toBeUndefined()
  })

  it('rejects a malformed chatModel and still releases the connection', async () => {
    m.release.mockClear()
    m.reserve.mockResolvedValue({ release: m.release })
    await expect(
      withEvalDb('public-bench-x', async () => 1, { chatModel: 'nope' }),
    ).rejects.toThrow(/eval chat model/i)
    expect(m.release).toHaveBeenCalledTimes(1)
  })
})
