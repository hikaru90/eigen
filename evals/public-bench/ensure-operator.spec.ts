import { beforeEach, describe, expect, it, vi } from 'vitest'

const { insertEvalUserRowMock } = vi.hoisted(() => ({ insertEvalUserRowMock: vi.fn() }))

vi.mock('$lib/eval/store', () => ({ insertEvalUserRow: insertEvalUserRowMock }))

import { PLATFORM_CHAT_MODEL, PLATFORM_EMBEDDING_MODEL } from '$lib/server/billing/platform-llm'
import {
  ensurePublicBenchOperator,
  PublicBenchConfigError,
  resolvePublicBenchEnv,
} from './ensure-operator'

const FULL_ENV = {
  OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
  SERVICE_API_KEY_OPENROUTER: 'sk-test',
}

function problemsOf(env: NodeJS.ProcessEnv): string[] {
  try {
    resolvePublicBenchEnv(env)
  } catch (err) {
    expect(err).toBeInstanceOf(PublicBenchConfigError)
    return (err as PublicBenchConfigError).problems
  }
  throw new Error('expected resolvePublicBenchEnv to throw')
}

describe('resolvePublicBenchEnv', () => {
  it('returns the pinned platform models when the gateway env is set', () => {
    expect(resolvePublicBenchEnv(FULL_ENV)).toEqual({
      modelChat: PLATFORM_CHAT_MODEL,
      modelEmbedding: PLATFORM_EMBEDDING_MODEL,
    })
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

  it('rejects model env that disagrees with the pinned models, alongside missing vars', () => {
    const problems = problemsOf({
      OPENROUTER_BASE_URL: ' ',
      LLM_MODEL_CHAT: 'openai/gpt-4o-mini',
      LLM_MODEL_EMBEDDING: PLATFORM_EMBEDDING_MODEL,
    })
    const text = problems.join('\n')
    expect(problems).toHaveLength(3)
    expect(text).toContain('OPENROUTER_BASE_URL')
    expect(text).toContain('SERVICE_API_KEY_OPENROUTER')
    expect(text).toContain('LLM_MODEL_CHAT=openai/gpt-4o-mini')
    expect(text).not.toContain('LLM_MODEL_EMBEDDING')
  })

  it('accepts model env that matches the pinned models', () => {
    expect(
      resolvePublicBenchEnv({
        ...FULL_ENV,
        LLM_MODEL_CHAT: PLATFORM_CHAT_MODEL,
        LLM_MODEL_EMBEDDING: PLATFORM_EMBEDDING_MODEL,
      }),
    ).toEqual({ modelChat: PLATFORM_CHAT_MODEL, modelEmbedding: PLATFORM_EMBEDDING_MODEL })
  })
})

describe('ensurePublicBenchOperator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    insertEvalUserRowMock.mockResolvedValue(undefined)
  })

  it('fails on bad env before touching the DB', async () => {
    const saved = process.env
    process.env = {}
    try {
      await expect(
        ensurePublicBenchOperator({ operatorUserId: 'op-1', displayName: 'Op' }),
      ).rejects.toThrow(/OPENROUTER_BASE_URL/)
    } finally {
      process.env = saved
    }
    expect(insertEvalUserRowMock).not.toHaveBeenCalled()
  })

  it('creates the operator user (which funds its wallet) and returns the models', async () => {
    const saved = process.env
    process.env = { ...FULL_ENV }
    try {
      const models = await ensurePublicBenchOperator({ operatorUserId: 'op-1', displayName: 'Op' })
      expect(models).toEqual({
        modelChat: PLATFORM_CHAT_MODEL,
        modelEmbedding: PLATFORM_EMBEDDING_MODEL,
      })
    } finally {
      process.env = saved
    }
    expect(insertEvalUserRowMock).toHaveBeenCalledWith('op-1', 'Op')
  })

  it('rejects a blank operator id or display name', async () => {
    await expect(
      ensurePublicBenchOperator({ operatorUserId: ' ', displayName: 'Op' }),
    ).rejects.toThrow(/operatorUserId/)
    await expect(
      ensurePublicBenchOperator({ operatorUserId: 'op-1', displayName: '' }),
    ).rejects.toThrow(/displayName/)
  })
})
