import { describe, expect, it, vi, beforeEach } from 'vitest'
import { billingUserAsyncLocal } from './context'

const { withDbUserMock, limitMock } = vi.hoisted(() => ({
  withDbUserMock: vi.fn(),
  limitMock: vi.fn(),
}))

vi.mock('$env/dynamic/private', () => ({
  env: {
    LLM_BASE_URL: 'https://eurouter.example/v1',
    SERVICE_API_KEY_EUROUTER: 'key',
    LLM_RULE_CHAT: 'rule-chat',
    LLM_RULE_EMBEDDING: 'rule-embed',
  },
}))

vi.mock('$lib/server/db', () => ({
  withDbUser: withDbUserMock,
}))

describe('loadPlatformLlmConfig eval billing context', () => {
  beforeEach(() => {
    withDbUserMock.mockReset()
    limitMock.mockReset()
    limitMock.mockResolvedValue([])
    withDbUserMock.mockImplementation(
      async (userId: string, fn: (db: unknown) => Promise<unknown>) => {
        expect(userId).toBe('operator-1')
        return fn({
          select: () => ({
            from: () => ({
              where: () => ({
                limit: limitMock,
              }),
            }),
          }),
        })
      },
    )
  })

  it('reads active provider under operator RLS, not eval tenant session', async () => {
    const { loadPlatformLlmConfig } = await import('./platform-llm')
    await billingUserAsyncLocal.run('operator-1', async () => {
      await loadPlatformLlmConfig('operator-1')
    })
    expect(withDbUserMock).toHaveBeenCalledWith('operator-1', expect.any(Function))
    expect(limitMock).toHaveBeenCalled()
  })
})
