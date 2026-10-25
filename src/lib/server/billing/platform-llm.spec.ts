import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withEvalChatModel } from '$lib/server/llm/eval-chat-model'
import {
  PLATFORM_CHAT_MODEL,
  PLATFORM_EMBEDDING_MODEL,
  loadPlatformLlmConfig,
  loadPlatformOpenRouterSttConfig,
} from './platform-llm'

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, string | undefined>,
}))

vi.mock('$lib/server/env/private-env', () => ({
  env: mockEnv,
}))

describe('loadPlatformLlmConfig', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockEnv)) {
      delete mockEnv[key]
    }
  })

  it('always routes platform inference through OpenRouter on the service key', async () => {
    mockEnv.OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1/'
    mockEnv.SERVICE_API_KEY_OPENROUTER = 'openrouter-service-key'
    // EUrouter env left over from before must not change the route
    mockEnv.LLM_BASE_URL = 'https://api.eurouter.ai/api/v1'
    mockEnv.SERVICE_API_KEY_EUROUTER = 'eurouter-service-key'
    mockEnv.LLM_RULE_CHAT = 'rule-chat'

    expect(await loadPlatformLlmConfig('user-1')).toEqual({
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'openrouter-service-key',
      modelChat: PLATFORM_CHAT_MODEL,
      modelEmbedding: PLATFORM_EMBEDDING_MODEL,
    })
  })

  it('pins DeepSeek V4.1 Flash for chat and Qwen3 Embedding 8B for vectors', () => {
    expect(PLATFORM_CHAT_MODEL).toBe('deepseek/deepseek-v4.1-flash-1017')
    expect(PLATFORM_EMBEDDING_MODEL).toBe('qwen/qwen3-embedding-8b')
  })

  it('throws when OPENROUTER_BASE_URL is missing', async () => {
    mockEnv.SERVICE_API_KEY_OPENROUTER = 'openrouter-service-key'
    await expect(loadPlatformLlmConfig('user-1')).rejects.toThrow(/OPENROUTER_BASE_URL/)
  })

  it('throws when SERVICE_API_KEY_OPENROUTER is missing', async () => {
    mockEnv.OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
    await expect(loadPlatformLlmConfig('user-1')).rejects.toThrow(/SERVICE_API_KEY_OPENROUTER/)
  })
})

describe('loadPlatformLlmConfig with an eval chat model override', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockEnv)) {
      delete mockEnv[key]
    }
    mockEnv.OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
    mockEnv.SERVICE_API_KEY_OPENROUTER = 'openrouter-service-key'
  })

  it('overrides only the chat model for a harness billing user', async () => {
    const config = await withEvalChatModel('openai/gpt-4o-mini', () =>
      loadPlatformLlmConfig('public-bench-runner'),
    )
    expect(config).toEqual({
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'openrouter-service-key',
      modelChat: 'openai/gpt-4o-mini',
      modelEmbedding: PLATFORM_EMBEDDING_MODEL,
    })
  })

  it('accepts every harness operator wallet', async () => {
    for (const operator of ['longmemeval-runner', 'eval-runner-operator', 'graph-scale-runner']) {
      const config = await withEvalChatModel('openai/gpt-4o-mini', () =>
        loadPlatformLlmConfig(operator),
      )
      expect(config.modelChat).toBe('openai/gpt-4o-mini')
    }
  })

  it('throws for a non-harness user and never returns the override', async () => {
    await expect(
      withEvalChatModel('openai/gpt-4o-mini', () => loadPlatformLlmConfig('user-1')),
    ).rejects.toThrow(/harness/i)
  })

  it('without an override a harness user still gets the pinned models', async () => {
    const config = await loadPlatformLlmConfig('public-bench-runner')
    expect(config.modelChat).toBe(PLATFORM_CHAT_MODEL)
    expect(config.modelEmbedding).toBe(PLATFORM_EMBEDDING_MODEL)
  })
})

describe('loadPlatformOpenRouterSttConfig', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockEnv)) {
      delete mockEnv[key]
    }
  })

  it('loads STT config from service OpenRouter key', async () => {
    mockEnv.OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
    mockEnv.SERVICE_API_KEY_OPENROUTER = 'openrouter-service-key'

    const config = await loadPlatformOpenRouterSttConfig()

    expect(config.provider).toBe('openrouter')
    expect(config.apiKey).toBe('openrouter-service-key')
  })

  it('throws when SERVICE_API_KEY_OPENROUTER is missing', async () => {
    mockEnv.OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

    await expect(loadPlatformOpenRouterSttConfig()).rejects.toThrow(/SERVICE_API_KEY_OPENROUTER/)
  })
})
