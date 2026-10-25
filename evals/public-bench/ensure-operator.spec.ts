import { beforeEach, describe, expect, it, vi } from 'vitest'

const { insertEvalUserRowMock } = vi.hoisted(() => ({ insertEvalUserRowMock: vi.fn() }))

vi.mock('$lib/eval/store', () => ({ insertEvalUserRow: insertEvalUserRowMock }))

import { PLATFORM_EMBEDDING_MODEL } from '$lib/server/billing/platform-llm'
import {
  assertPublicBenchGatewayEnv,
  ensurePublicBenchOperator,
  PublicBenchConfigError,
} from './ensure-operator'

const FULL_ENV = {
  OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
  SERVICE_API_KEY_OPENROUTER: 'sk-test',
}

function problemsOf(env: NodeJS.ProcessEnv): string[] {
  try {
    assertPublicBenchGatewayEnv(env)
  } catch (err) {
    expect(err).toBeInstanceOf(PublicBenchConfigError)
    return (err as PublicBenchConfigError).problems
  }
  throw new Error('expected assertPublicBenchGatewayEnv to throw')
}

describe('assertPublicBenchGatewayEnv', () => {
  it('passes when the gateway env is set', () => {
    expect(() => assertPublicBenchGatewayEnv(FULL_ENV)).not.toThrow()
  })

  it('names every missing variable in one error', () => {
    const problems = problemsOf({})
    expect(problems).toHaveLength(2)
    expect(problems.join('\n')).toContain('OPENROUTER_BASE_URL')
    expect(problems.join('\n')).toContain('SERVICE_API_KEY_OPENROUTER')
  })

  it('treats blank values as missing and lists only the missing ones', () => {
    const problems = problemsOf({ ...FULL_ENV, SERVICE_API_KEY_OPENROUTER: '   ' })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('SERVICE_API_KEY_OPENROUTER')
  })

  it('ignores the old LLM_MODEL_* variables (the --chat-model flag replaces them)', () => {
    expect(() =>
      assertPublicBenchGatewayEnv({
        ...FULL_ENV,
        LLM_MODEL_CHAT: 'something/else',
        LLM_MODEL_EMBEDDING: 'something/else',
      }),
    ).not.toThrow()
  })
})

describe('ensurePublicBenchOperator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    insertEvalUserRowMock.mockResolvedValue(undefined)
  })

  async function withEnv<T>(env: NodeJS.ProcessEnv, fn: () => Promise<T>): Promise<T> {
    const saved = process.env
    process.env = env
    try {
      return await fn()
    } finally {
      process.env = saved
    }
  }

  const base = { operatorUserId: 'op-1', displayName: 'Op', chatModel: 'openai/gpt-4o-mini' }

  it('fails on bad env before touching the DB', async () => {
    await withEnv({}, async () => {
      await expect(ensurePublicBenchOperator(base)).rejects.toThrow(/OPENROUTER_BASE_URL/)
    })
    expect(insertEvalUserRowMock).not.toHaveBeenCalled()
  })

  it('creates the operator user (which funds its wallet) and returns the chosen chat model', async () => {
    const models = await withEnv({ ...FULL_ENV }, () => ensurePublicBenchOperator(base))
    expect(models).toEqual({
      modelChat: 'openai/gpt-4o-mini',
      modelEmbedding: PLATFORM_EMBEDDING_MODEL,
    })
    expect(insertEvalUserRowMock).toHaveBeenCalledWith('op-1', 'Op')
  })

  it('does not read LLM_MODEL_CHAT / LLM_MODEL_EMBEDDING', async () => {
    const models = await withEnv(
      { ...FULL_ENV, LLM_MODEL_CHAT: 'x/y', LLM_MODEL_EMBEDDING: 'x/z' },
      () => ensurePublicBenchOperator(base),
    )
    expect(models.modelChat).toBe('openai/gpt-4o-mini')
    expect(models.modelEmbedding).toBe(PLATFORM_EMBEDDING_MODEL)
  })

  it('rejects a blank or malformed chat model before touching the DB', async () => {
    await withEnv({ ...FULL_ENV }, async () => {
      await expect(ensurePublicBenchOperator({ ...base, chatModel: ' ' })).rejects.toThrow(
        /chat model/i,
      )
      await expect(
        ensurePublicBenchOperator({ ...base, chatModel: 'gpt-4o-mini' }),
      ).rejects.toThrow(/chat model/i)
    })
    expect(insertEvalUserRowMock).not.toHaveBeenCalled()
  })

  it('rejects a blank operator id or display name', async () => {
    await expect(ensurePublicBenchOperator({ ...base, operatorUserId: ' ' })).rejects.toThrow(
      /operatorUserId/,
    )
    await expect(ensurePublicBenchOperator({ ...base, displayName: '' })).rejects.toThrow(
      /displayName/,
    )
  })
})
