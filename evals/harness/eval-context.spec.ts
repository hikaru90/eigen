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
import { currentEvalClock, withEvalClock } from '$lib/server/llm/eval-clock'
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

describe('withEvalDb clock', () => {
  const CLOCK = new Date('2025-03-01T09:00:00.000Z')

  it('runs the callback (and everything it awaits) under the eval clock', async () => {
    m.reserve.mockResolvedValue({ release: m.release })
    const seen = await withEvalDb(
      'public-bench-x',
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 1))
        return currentEvalClock()?.toISOString()
      },
      { billingUserId: 'public-bench-runner', clock: CLOCK },
    )
    expect(seen).toBe(CLOCK.toISOString())
    expect(currentEvalClock()).toBeUndefined()
  })

  it('leaves the clock unset without the option', async () => {
    m.reserve.mockResolvedValue({ release: m.release })
    const seen = await withEvalDb('public-bench-x', async () => currentEvalClock())
    expect(seen).toBeUndefined()
  })

  it('a per-turn withEvalClock inside the callback shadows the option', async () => {
    m.reserve.mockResolvedValue({ release: m.release })
    const seen = await withEvalDb(
      'public-bench-x',
      async () =>
        withEvalClock(new Date('2025-03-02T09:00:00.000Z'), async () =>
          currentEvalClock()?.toISOString(),
        ),
      { clock: CLOCK },
    )
    expect(seen).toBe('2025-03-02T09:00:00.000Z')
  })

  it('combines with chatModel', async () => {
    m.reserve.mockResolvedValue({ release: m.release })
    const seen = await withEvalDb(
      'public-bench-x',
      async () => [currentEvalChatModel(), currentEvalClock()?.toISOString()],
      { chatModel: 'openai/gpt-4o-mini', clock: CLOCK },
    )
    expect(seen).toEqual(['openai/gpt-4o-mini', CLOCK.toISOString()])
  })

  it('rejects an invalid clock and still releases the connection', async () => {
    m.release.mockClear()
    m.reserve.mockResolvedValue({ release: m.release })
    await expect(
      withEvalDb('public-bench-x', async () => 1, { clock: new Date('nope') }),
    ).rejects.toThrow(/eval clock/i)
    expect(m.release).toHaveBeenCalledTimes(1)
  })
})
