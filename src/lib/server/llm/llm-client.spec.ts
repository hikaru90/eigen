import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExtendedPrivateEnv } from '$lib/server/env/private-env'
import { fetchMockInit, fetchMockUrl } from '$lib/test/vitest-mock-call'
import {
  DEFAULT_CHAT_MAX_TOKENS,
  llmChatCompletion,
  llmCreateEmbeddings,
  llmCreateTranscription,
} from './llm-client'

const { mockEnv, logActivityCallMock, getDbMock, decryptTenantValueMock, captureServerEventMock } =
  vi.hoisted(() => {
    function makeDbMock() {
      // Returns a chainable Drizzle-style builder that resolves to [] (no DB rows).
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.from = () => chain
      chain.where = () => chain
      chain.and = () => chain
      chain.limit = () => Promise.resolve([])
      return chain
    }

    return {
      mockEnv: {
        LLM_MIN_REQUEST_INTERVAL_MS: '0',
        LLM_REQUEST_TIMEOUT_MS: '',
        LLM_SERIAL_REQUESTS: '',
        OPENROUTER_BASE_URL: 'https://openrouter.example/api/v1',
        SERVICE_API_KEY_OPENROUTER: 'service-openrouter-key',
      } as ExtendedPrivateEnv,
      logActivityCallMock: vi.fn(),
      getDbMock: vi.fn(() => makeDbMock()),
      decryptTenantValueMock: vi.fn(async () => 'decrypted-key'),
      captureServerEventMock: vi.fn(),
    }
  })

vi.mock('$lib/server/env/private-env', () => ({
  env: mockEnv,
}))

vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
  withDbUser: async (_userId: string, fn: (db: ReturnType<typeof getDbMock>) => Promise<unknown>) =>
    fn(getDbMock()),
}))

vi.mock('$lib/server/activity/log-call', () => ({
  logActivityCall: logActivityCallMock,
}))

vi.mock('$lib/server/analytics/posthog-server', () => ({
  captureServerEvent: captureServerEventMock,
}))

vi.mock('$lib/server/billing/usage-gate', () => ({
  withPlatformBilling: vi.fn(async (_userId, _settle, fn) => fn()),
}))

vi.mock('$lib/server/crypto/tenant-encryption', () => ({
  decryptTenantValue: decryptTenantValueMock,
}))

function fetchThatWaitsForAbort(): ReturnType<typeof vi.fn> {
  return vi.fn((_url: unknown, init?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      const signal = init?.signal
      if (signal?.aborted) {
        reject(signal.reason)
        return
      }
      signal?.addEventListener('abort', () => reject(signal.reason))
    })
  })
}

function response(ok: boolean, status: number, body: unknown): Response {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

describe('llm client retries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnv.OPENROUTER_BASE_URL = 'https://example.test'
    mockEnv.LLM_MIN_REQUEST_INTERVAL_MS = '0'
    mockEnv.LLM_REQUEST_TIMEOUT_MS = ''
    mockEnv.SERVICE_API_KEY_OPENROUTER = 'key-1'
  })

  it('chat succeeds and logs cost as 0 when response has no usage field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(true, 200, { choices: [] })),
    )

    await llmChatCompletion({
      userId: 'u1',
      messages: [{ role: 'user', content: 'hello' }],
    })

    expect(logActivityCallMock).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      expect.objectContaining({
        operation: 'llm.chat.chat.success(attempt=1)',
        baseCostUsd: 0,
        gatewayHost: 'example.test',
      }),
    )
  })

  it('chat succeeds and logs activity', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(true, 200, {
          usage: { prompt_tokens: 10, completion_tokens: 10 },
          choices: [],
        }),
      ),
    )

    await llmChatCompletion({
      userId: 'u1',
      messages: [{ role: 'user', content: 'hello' }],
    })

    expect(logActivityCallMock).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      expect.objectContaining({
        provider: 'openrouter',
        operation: 'llm.chat.chat.success(attempt=1)',
        gatewayHost: 'example.test',
      }),
    )
  })

  it('captures ai generation on successful chat completion', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(true, 200, {
          usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 },
          choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
        }),
      ),
    )

    await llmChatCompletion({
      userId: 'u1',
      messages: [{ role: 'user', content: 'hello observability' }],
      aiSessionId: 'session-1',
      aiTraceId: 'trace-1',
    })

    expect(captureServerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: 'u1',
        event: '$ai_generation',
        properties: expect.objectContaining({
          $ai_session_id: 'session-1',
          $ai_trace_id: 'trace-1',
          $ai_model: 'deepseek/deepseek-v4.1-flash-1017',
          $ai_provider: 'openrouter',
          $ai_input_tokens: 12,
          $ai_output_tokens: 34,
          $ai_stop_reason: 'stop',
          $ai_latency: expect.any(Number),
        }),
      }),
    )
  })

  it('chat includes temperature when provided', async () => {
    const fetchMock = vi.fn(async () =>
      response(true, 200, {
        usage: { prompt_tokens: 1, completion_tokens: 1 },
        choices: [],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await llmChatCompletion({
      userId: 'u1',
      messages: [{ role: 'user', content: 'hello' }],
      temperature: 0.7,
    })

    const body = JSON.parse(fetchMockInit(fetchMock, 0).body as string) as {
      temperature?: number
      model?: string
    }
    expect(body.temperature).toBe(0.7)
    expect(body.model).toBe('deepseek/deepseek-v4.1-flash-1017')
  })

  it('chat retries exactly three attempts then fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(false, 500, { error: 'down' })),
    )
    await expect(
      llmChatCompletion({
        userId: 'u1',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    ).rejects.toThrow(/LLM HTTP 500/)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('captures ai generation error when all chat retries fail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(false, 500, { error: 'down' })),
    )

    await expect(
      llmChatCompletion({
        userId: 'u1',
        messages: [{ role: 'user', content: 'hello' }],
        aiSessionId: 'session-error',
        aiTraceId: 'trace-error',
      }),
    ).rejects.toThrow(/LLM HTTP 500/)

    expect(captureServerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: 'u1',
        event: '$ai_generation',
        properties: expect.objectContaining({
          $ai_session_id: 'session-error',
          $ai_trace_id: 'trace-error',
          $ai_model: 'deepseek/deepseek-v4.1-flash-1017',
          $ai_provider: 'openrouter',
          $ai_http_status: 500,
          $ai_is_error: true,
          $ai_error: expect.any(String),
        }),
      }),
    )
  })

  it('fails when chat api key is missing', async () => {
    mockEnv.SERVICE_API_KEY_OPENROUTER = ''
    await expect(
      llmChatCompletion({ userId: 'u1', messages: [{ role: 'user', content: 'hello' }] }),
    ).rejects.toThrow(/SERVICE_API_KEY_OPENROUTER/)
  })

  it('parses gateway host from bare hostnames and invalid URLs', async () => {
    mockEnv.OPENROUTER_BASE_URL = 'api.example.test/'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(true, 200, { choices: [{ message: { content: 'ok' } }] })),
    )
    await llmChatCompletion({ userId: 'u1', messages: [{ role: 'user', content: 'hello' }] })
    expect(logActivityCallMock).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      expect.objectContaining({ gatewayHost: 'api.example.test' }),
    )
  })

  it('rejects invalid LLM_REQUEST_TIMEOUT_MS', async () => {
    mockEnv.LLM_REQUEST_TIMEOUT_MS = '0'
    await expect(
      llmChatCompletion({ userId: 'u1', messages: [{ role: 'user', content: 'hello' }] }),
    ).rejects.toThrow(/LLM_REQUEST_TIMEOUT_MS/)
  })

  it('rejects invalid LLM_MIN_REQUEST_INTERVAL_MS', async () => {
    mockEnv.LLM_MIN_REQUEST_INTERVAL_MS = 'not-a-number'
    await expect(
      llmChatCompletion({ userId: 'u1', messages: [{ role: 'user', content: 'hello' }] }),
    ).rejects.toThrow(/LLM_MIN_REQUEST_INTERVAL_MS/)
  })

  it('falls back to trimmed base URL when gateway host cannot be parsed', async () => {
    mockEnv.OPENROUTER_BASE_URL = '%%%not-a-valid-url%%%'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(true, 200, { choices: [] })),
    )
    await llmChatCompletion({ userId: 'u1', messages: [{ role: 'user', content: 'hello' }] })
    expect(logActivityCallMock).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      expect.objectContaining({ gatewayHost: '%%%not-a-valid-url%%%' }),
    )
  })

  it('embedding succeeds after retries', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(false, 500, { error: 'temp' }))
      .mockResolvedValueOnce(response(true, 200, { usage: { total_tokens: 100 }, data: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await llmCreateEmbeddings({ userId: 'u1', input: 'hello' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(logActivityCallMock).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      expect.objectContaining({
        operation: 'llm.embedding.error(attempt=1)',
        gatewayHost: 'example.test',
      }),
    )
    expect(logActivityCallMock).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      expect.objectContaining({
        operation: 'llm.embedding.success(attempt=2)',
        gatewayHost: 'example.test',
      }),
    )
  })

  it('fails when required env is missing', async () => {
    mockEnv.SERVICE_API_KEY_OPENROUTER = ''
    await expect(llmCreateEmbeddings({ userId: 'u1', input: 'hello' })).rejects.toThrow(
      /SERVICE_API_KEY_OPENROUTER/,
    )
  })

  it('fails when base url is missing', async () => {
    mockEnv.OPENROUTER_BASE_URL = ''
    await expect(llmCreateEmbeddings({ userId: 'u1', input: 'hello' })).rejects.toThrow(
      /OPENROUTER_BASE_URL/,
    )
  })

  it('handles non-json error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 404,
            text: async () => 'route missing',
          }) as unknown as Response,
      ),
    )
    await expect(llmCreateEmbeddings({ userId: 'u1', input: 'hello' })).rejects.toThrow(
      /LLM HTTP 404/,
    )
  })

  it('handles non-json chat error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 500,
            text: async () => 'oops',
          }) as unknown as Response,
      ),
    )
    await expect(
      llmChatCompletion({ userId: 'u1', messages: [{ role: 'user', content: 'hello' }] }),
    ).rejects.toThrow(/LLM HTTP 500/)
  })

  it('throws fallback error when fetch throws non-error value', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject('boom')),
    )
    await expect(
      llmChatCompletion({ userId: 'u1', messages: [{ role: 'user', content: 'hello' }] }),
    ).rejects.toThrow(/failed after 3 attempts/)
  })

  it('embedding throws fallback error on non-error throw', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject('boom')),
    )
    await expect(llmCreateEmbeddings({ userId: 'u1', input: 'hello' })).rejects.toThrow(
      /failed after 3 attempts/,
    )
  })

  it('rejects negative or non-numeric LLM_MIN_REQUEST_INTERVAL_MS', async () => {
    mockEnv.LLM_MIN_REQUEST_INTERVAL_MS = '-1'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(true, 200, { usage: { total_tokens: 5 }, data: [] })),
    )
    await expect(llmCreateEmbeddings({ userId: 'u1', input: 'hello' })).rejects.toThrow(
      /LLM_MIN_REQUEST_INTERVAL_MS must be a non-negative number/,
    )
  })

  it('rate-limits successive calls when interval is configured', async () => {
    vi.resetModules()
    vi.useFakeTimers()
    try {
      mockEnv.LLM_MIN_REQUEST_INTERVAL_MS = '50'
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          response(true, 200, {
            usage: { prompt_tokens: 1, completion_tokens: 1 },
            choices: [],
          }),
        ),
      )
      const { llmChatCompletion: chat } = await import('./llm-client')
      const first = chat({ userId: 'u1', messages: [{ role: 'user', content: 'hi' }] })
      await vi.advanceTimersByTimeAsync(0)
      const second = chat({ userId: 'u1', messages: [{ role: 'user', content: 'hi' }] })
      await vi.advanceTimersByTimeAsync(50)
      await first
      await second
      expect(fetch).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('pipelines in-flight requests when overlapping callers do not await prior completions', async () => {
    vi.resetModules()
    vi.useFakeTimers()
    try {
      mockEnv.LLM_MIN_REQUEST_INTERVAL_MS = '1000'
      const pendingResolvers: Array<(value: Response) => void> = []
      const fetchMock = vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            pendingResolvers.push(resolve)
          }),
      )
      vi.stubGlobal('fetch', fetchMock)

      const { llmChatCompletion: chat } = await import('./llm-client')
      const okBody = {
        usage: { prompt_tokens: 1, completion_tokens: 1 },
        choices: [{ message: { content: 'ok' } }],
      }

      const first = chat({ userId: 'u1', messages: [{ role: 'user', content: '1' }] })
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchMock).toHaveBeenCalledTimes(1)

      const second = chat({ userId: 'u1', messages: [{ role: 'user', content: '2' }] })
      await vi.advanceTimersByTimeAsync(1000)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(pendingResolvers).toHaveLength(2)

      const third = chat({ userId: 'u1', messages: [{ role: 'user', content: '3' }] })
      await vi.advanceTimersByTimeAsync(1000)
      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(pendingResolvers).toHaveLength(3)

      for (const resolve of pendingResolvers) {
        resolve(response(true, 200, okBody))
      }
      await Promise.all([first, second, third])
    } finally {
      vi.useRealTimers()
    }
  })

  it('serial mode waits for prior request completion plus interval before the next starts', async () => {
    vi.resetModules()
    vi.useFakeTimers()
    try {
      mockEnv.LLM_MIN_REQUEST_INTERVAL_MS = '1000'
      mockEnv.LLM_SERIAL_REQUESTS = '1'
      const pendingResolvers: Array<(value: Response) => void> = []
      const fetchMock = vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            pendingResolvers.push(resolve)
          }),
      )
      vi.stubGlobal('fetch', fetchMock)

      const { llmChatCompletion: chat } = await import('./llm-client')
      const okBody = {
        usage: { prompt_tokens: 1, completion_tokens: 1 },
        choices: [{ message: { content: 'ok' } }],
      }

      const first = chat({ userId: 'u1', messages: [{ role: 'user', content: '1' }] })
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchMock).toHaveBeenCalledTimes(1)

      const second = chat({ userId: 'u1', messages: [{ role: 'user', content: '2' }] })
      await vi.advanceTimersByTimeAsync(1000)
      expect(fetchMock).toHaveBeenCalledTimes(1)

      pendingResolvers[0]!(response(true, 200, okBody))
      await first
      await vi.advanceTimersByTimeAsync(1000)
      expect(fetchMock).toHaveBeenCalledTimes(2)

      pendingResolvers[1]!(response(true, 200, okBody))
      await second
    } finally {
      vi.useRealTimers()
    }
  })

})

describe('llmCreateTranscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnv.LLM_REQUEST_TIMEOUT_MS = ''
    mockEnv.LLM_MIN_REQUEST_INTERVAL_MS = '0'
    mockEnv.OPENROUTER_BASE_URL = 'https://openrouter.example/api/v1'
    mockEnv.OPENROUTER_API_KEY = 'openrouter-key'
    mockEnv.SERVICE_API_KEY_OPENROUTER = 'service-openrouter-key'
  })

  it('platform credits uses SERVICE_API_KEY_OPENROUTER for speech-to-text', async () => {
    const fetchMock = vi.fn(async () =>
      response(true, 200, { text: 'platform', usage: { cost: 0.001 } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await llmCreateTranscription({
      userId: 'u1',
      model: 'qwen/qwen3-asr-0.6b',
      audio: { bytes: new Uint8Array([1]), format: 'webm' },
    })
    expect(String(fetchMockUrl(fetchMock, 0))).toBe(
      'https://openrouter.example/api/v1/audio/transcriptions',
    )
    const auth = fetchMockInit(fetchMock, 0)?.headers as Record<string, string>
    expect(auth.Authorization).toBe('Bearer service-openrouter-key')
  })

  it('posts audio to OpenRouter /audio/transcriptions without a language hint (the model identifies it)', async () => {
    const fetchMock = vi.fn(async () =>
      response(true, 200, { text: 'hello', usage: { cost: 0.001 } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const out = await llmCreateTranscription({
      userId: 'u1',
      model: 'qwen/qwen3-asr-0.6b',
      audio: { bytes: new Uint8Array([1, 2, 3]), format: 'webm' },
    })
    expect((out as { text: string }).text).toBe('hello')
    const url = fetchMockUrl(fetchMock, 0)
    expect(String(url)).toBe('https://openrouter.example/api/v1/audio/transcriptions')
    const body = JSON.parse(fetchMockInit(fetchMock, 0).body as string) as {
      model: string
      input_audio: { data: string; format: string }
    }
    expect(body.model).toBe('qwen/qwen3-asr-0.6b')
    expect(body.input_audio.format).toBe('webm')
    expect(body).not.toHaveProperty('language')
    expect(body.input_audio.data).toBe(Buffer.from([1, 2, 3]).toString('base64'))
  })

  it('logs OpenRouter STT cost from usage.cost in activity', async () => {
    const fetchMock = vi.fn(async () =>
      response(true, 200, { text: 'hello', usage: { cost: 0.0035 } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await llmCreateTranscription({
      userId: 'u1',
      model: 'qwen/qwen3-asr-0.6b',
      audio: { bytes: new Uint8Array([1, 2, 3]), format: 'webm' },
    })
    expect(logActivityCallMock).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      expect.objectContaining({
        provider: 'openrouter',
        operation: expect.stringContaining('llm.stt.success'),
        baseCostUsd: 0.0035,
        gatewayHost: 'openrouter.example',
      }),
    )
  })

  it('STT retries on HTTP error then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(false, 503, { error: 'busy' }))
      .mockResolvedValueOnce(response(true, 200, { text: 'retry ok', usage: { cost: 0.001 } }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await llmCreateTranscription({
      userId: 'u1',
      model: 'qwen/qwen3-asr-0.6b',
      audio: { bytes: new Uint8Array([1]), format: 'webm' },
    })
    expect((out as { text: string }).text).toBe('retry ok')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(logActivityCallMock).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      expect.objectContaining({ operation: expect.stringContaining('llm.stt.error(attempt=1') }),
    )
  })

  it('STT fails after three HTTP errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(false, 502, { error: 'bad gateway' })),
    )
    await expect(
      llmCreateTranscription({
        userId: 'u1',
        model: 'qwen/qwen3-asr-0.6b',
        audio: { bytes: new Uint8Array([1]), format: 'webm' },
      }),
    ).rejects.toThrow(/LLM STT HTTP 502/)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('STT handles non-json error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 400,
            text: async () => 'invalid audio',
          }) as unknown as Response,
      ),
    )
    await expect(
      llmCreateTranscription({
        userId: 'u1',
        model: 'qwen/qwen3-asr-0.6b',
        audio: { bytes: new Uint8Array([1]), format: 'webm' },
      }),
    ).rejects.toThrow(/LLM STT HTTP 400/)
  })

  it('STT throws fallback error when fetch rejects non-error value', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject('stt-boom')),
    )
    await expect(
      llmCreateTranscription({
        userId: 'u1',
        model: 'qwen/qwen3-asr-0.6b',
        audio: { bytes: new Uint8Array([1]), format: 'webm' },
      }),
    ).rejects.toThrow(/failed after 3 attempts/)
  })

  it('STT parses transcript from choices message content', async () => {
    const fetchMock = vi.fn(async () =>
      response(true, 200, {
        choices: [{ message: { content: 'from choices' } }],
        usage: { cost: 0.002 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await llmCreateTranscription({
      userId: 'u1',
      model: 'qwen/qwen3-asr-0.6b',
      audio: { bytes: new Uint8Array([1]), format: 'webm' },
    })
    expect(logActivityCallMock).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      expect.objectContaining({ context: 'from choices' }),
    )
  })

  it('STT uses transcript preview context when cost is present but text field is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(true, 200, {
          choices: [{ message: { content: 'heard this' } }],
          usage: { cost: 0.002 },
        }),
      ),
    )
    await llmCreateTranscription({
      userId: 'u1',
      model: 'qwen/qwen3-asr-0.6b',
      audio: { bytes: new Uint8Array([1]), format: 'webm' },
    })
    expect(logActivityCallMock).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      expect.objectContaining({ context: 'heard this', baseCostUsd: 0.002 }),
    )
  })

  it('STT logs fallback context when transcript text is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(true, 200, { usage: {} })),
    )
    await llmCreateTranscription({
      userId: 'u1',
      model: 'qwen/qwen3-asr-0.6b',
      audio: { bytes: new Uint8Array([1]), format: 'webm' },
    })
    expect(logActivityCallMock).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      expect.objectContaining({
        context: 'stt:qwen/qwen3-asr-0.6b (usage cost missing from gateway)',
      }),
    )
  })

  it('platform STT fails when SERVICE_API_KEY_OPENROUTER is missing', async () => {
    mockEnv.SERVICE_API_KEY_OPENROUTER = ''
    await expect(
      llmCreateTranscription({
        userId: 'u1',
        model: 'qwen/qwen3-asr-0.6b',
        audio: { bytes: new Uint8Array([1]), format: 'webm' },
      }),
    ).rejects.toThrow(/SERVICE_API_KEY_OPENROUTER/)
  })

  it('STT aborts when LLM_REQUEST_TIMEOUT_MS elapses', async () => {
    mockEnv.LLM_REQUEST_TIMEOUT_MS = '1'
    vi.stubGlobal('fetch', fetchThatWaitsForAbort())
    await expect(
      llmCreateTranscription({
        userId: 'u1',
        model: 'qwen/qwen3-asr-0.6b',
        audio: { bytes: new Uint8Array([1]), format: 'webm' },
      }),
    ).rejects.toThrow(/LLM STT request timed out after 1ms/)
    expect(fetch).toHaveBeenCalledTimes(3)
  })
})

describe('llm client platform billing settlement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnv.OPENROUTER_BASE_URL = 'https://example.test'
    mockEnv.LLM_MIN_REQUEST_INTERVAL_MS = '0'
    mockEnv.LLM_REQUEST_TIMEOUT_MS = ''
    mockEnv.SERVICE_API_KEY_OPENROUTER = 'key-1'
  })

  it('settles provider-reported chat cost for platform billing', async () => {
    const { withPlatformBilling } = await import('$lib/server/billing/usage-gate')
    vi.mocked(withPlatformBilling).mockImplementation(async (_userId, settle, fn) => {
      const result = await fn()
      expect(settle(result)).toBe(0.005)
      return result
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(true, 200, { usage: { prompt_tokens: 1, cost: 0.005 }, choices: [] }),
      ),
    )
    await llmChatCompletion({ userId: 'u1', messages: [{ role: 'user', content: 'hi' }] })
  })

  it('settles provider-reported embedding cost for platform billing', async () => {
    const { withPlatformBilling } = await import('$lib/server/billing/usage-gate')
    vi.mocked(withPlatformBilling).mockImplementation(async (_userId, settle, fn) => {
      const result = await fn()
      expect(settle(result)).toBe(0.002)
      return result
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(true, 200, { usage: { total_tokens: 5, cost: 0.002 }, data: [] })),
    )
    await llmCreateEmbeddings({ userId: 'u1', input: 'hello' })
  })

  it('settles provider-reported STT cost for platform billing', async () => {
    const { withPlatformBilling } = await import('$lib/server/billing/usage-gate')
    vi.mocked(withPlatformBilling).mockImplementation(async (_userId, settle, fn) => {
      const result = await fn()
      expect(settle(result)).toBe(0.0015)
      return result
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(true, 200, { text: 'hello', usage: { cost: 0.0015 } })),
    )
    await llmCreateTranscription({
      userId: 'u1',
      model: 'qwen/qwen3-asr-0.6b',
      audio: { bytes: new Uint8Array([1]), format: 'webm' },
    })
  })

  it('throws when platform billing cannot settle missing gateway cost', async () => {
    const { withPlatformBilling } = await import('$lib/server/billing/usage-gate')
    vi.mocked(withPlatformBilling).mockImplementation(async (_userId, settle, fn) => {
      const result = await fn()
      expect(() => settle(result)).toThrow(/usage\.cost/)
      return result
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(true, 200, { usage: { total_tokens: 1 }, choices: [] })),
    )
    await llmChatCompletion({ userId: 'u1', messages: [{ role: 'user', content: 'hi' }] })
  })
})

describe('llm client platform billing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnv.OPENROUTER_BASE_URL = 'https://example.test'
    mockEnv.LLM_MIN_REQUEST_INTERVAL_MS = '0'
    mockEnv.LLM_REQUEST_TIMEOUT_MS = ''
    mockEnv.SERVICE_API_KEY_OPENROUTER = 'key-1'
    mockEnv.SERVICE_API_KEY_OPENROUTER = 'service-openrouter-key'
    mockEnv.OPENROUTER_BASE_URL = 'https://openrouter.example/api/v1'
  })

  it('platform chat always goes to OpenRouter with the service key and pinned model', async () => {
    const fetchMock = vi.fn(async () =>
      response(true, 200, { usage: { prompt_tokens: 1 }, choices: [] }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await llmChatCompletion({ userId: 'u1', messages: [{ role: 'user', content: 'hi' }] })
    const init = fetchMockInit(fetchMock, 0)
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer service-openrouter-key')
    const body = JSON.parse(String(init?.body)) as { model: string; rule_id?: string; provider?: unknown }
    expect(body.model).toBe('deepseek/deepseek-v4.1-flash-1017')
    expect(body.rule_id).toBeUndefined()
    expect(body.provider).toBeUndefined()
  })

  it('platform chat fails loud when SERVICE_API_KEY_OPENROUTER is missing', async () => {
    mockEnv.SERVICE_API_KEY_OPENROUTER = ''
    await expect(
      llmChatCompletion({ userId: 'u1', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/SERVICE_API_KEY_OPENROUTER/)
  })
})

describe('llm client response parsing and options', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnv.OPENROUTER_BASE_URL = 'https://example.test'
    mockEnv.LLM_MIN_REQUEST_INTERVAL_MS = '0'
    mockEnv.LLM_REQUEST_TIMEOUT_MS = ''
    mockEnv.SERVICE_API_KEY_OPENROUTER = 'key-1'
  })

  it('chat includes maxTokens when provided', async () => {
    const fetchMock = vi.fn(async () =>
      response(true, 200, { usage: { prompt_tokens: 1 }, choices: [] }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await llmChatCompletion({
      userId: 'u1',
      messages: [{ role: 'user', content: 'hello' }],
      maxTokens: 256,
    })
    const body = JSON.parse(fetchMockInit(fetchMock, 0).body as string) as {
      max_tokens?: number
    }
    expect(body.max_tokens).toBe(256)
  })

  it('chat sends a bounded default max_tokens when omitted (avoids full-context reservation)', async () => {
    const fetchMock = vi.fn(async () =>
      response(true, 200, { usage: { prompt_tokens: 1 }, choices: [] }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await llmChatCompletion({
      userId: 'u1',
      messages: [{ role: 'user', content: 'hello' }],
    })
    const body = JSON.parse(fetchMockInit(fetchMock, 0).body as string) as {
      max_tokens?: number
    }
    expect(body.max_tokens).toBe(DEFAULT_CHAT_MAX_TOKENS)
    expect(DEFAULT_CHAT_MAX_TOKENS).toBeLessThan(100_000)
  })

  it('chat logs empty response text for non-text message content', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(true, 200, {
          usage: { prompt_tokens: 1 },
          choices: [{ message: { content: { notText: true } } }],
        }),
      ),
    )
    await llmChatCompletion({
      userId: 'u1',
      messages: [{ role: 'user', content: 'hello' }],
      logContext: 'non-text',
    })
    expect(logSpy).toHaveBeenCalledWith('[llm.chat:non-text] response attempt 1:\n')
    logSpy.mockRestore()
  })

  it('chat logs array content parts from gateway response', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(true, 200, {
          usage: { prompt_tokens: 1 },
          choices: [
            {
              message: {
                content: [{ text: 'part-one' }, 'part-two', { text: 42 }, null],
              },
            },
          ],
        }),
      ),
    )
    await llmChatCompletion({
      userId: 'u1',
      messages: [{ role: 'user', content: 'hello' }],
      logContext: 'parse test',
    })
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[llm.chat:parse_test] response attempt 1:\npart-onepart-two'),
    )
    logSpy.mockRestore()
  })

  it('chat succeeds on second attempt after first failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(false, 429, { error: 'rate limited' }))
      .mockResolvedValueOnce(
        response(true, 200, {
          usage: { prompt_tokens: 1 },
          choices: [{ message: { content: 'ok' } }],
        }),
      )
    vi.stubGlobal('fetch', fetchMock)
    await llmChatCompletion({ userId: 'u1', messages: [{ role: 'user', content: 'hello' }] })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(logActivityCallMock).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      expect.objectContaining({ operation: 'llm.chat.chat.error(attempt=1)' }),
    )
  })

  it('chat uses empty context when no user message is present', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(true, 200, { usage: { prompt_tokens: 1 }, choices: [] })),
    )
    await llmChatCompletion({
      userId: 'u1',
      messages: [{ role: 'system', content: 'system only' }],
    })
    expect(logActivityCallMock).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      expect.objectContaining({ context: '' }),
    )
  })

  it('embedding logs and previews array input', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(true, 200, { usage: { total_tokens: 2 }, data: [] })),
    )
    await llmCreateEmbeddings({
      userId: 'u1',
      input: ['short', 'x'.repeat(200)],
    })
    expect(logSpy).toHaveBeenCalledWith('[llm.embedding] input[0]: short')
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[llm\.embedding\] input\[1\]: x+\.\.\./),
    )
    expect(logActivityCallMock).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      expect.objectContaining({ context: 'short' }),
    )
    logSpy.mockRestore()
  })

  it('chat logs error context as empty when no user message exists', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(false, 500, { error: 'down' }))
      .mockResolvedValueOnce(response(false, 500, { error: 'down' }))
      .mockResolvedValueOnce(response(false, 500, { error: 'down' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      llmChatCompletion({
        userId: 'u1',
        messages: [{ role: 'assistant', content: 'prior answer' }],
      }),
    ).rejects.toThrow(/LLM HTTP 500/)
    expect(logActivityCallMock).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      expect.objectContaining({ operation: 'llm.chat.chat.error(attempt=1)', context: '' }),
    )
  })

  it('embedding logs array input preview on error attempts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(false, 500, { error: 'down' })),
    )
    await expect(llmCreateEmbeddings({ userId: 'u1', input: ['alpha', 'beta'] })).rejects.toThrow(
      /LLM HTTP 500/,
    )
    expect(logActivityCallMock).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      expect.objectContaining({ operation: 'llm.embedding.error(attempt=1)', context: 'alpha' }),
    )
  })

})

describe('llm client timeout and rate limit defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnv.OPENROUTER_BASE_URL = 'https://example.test'
    mockEnv.SERVICE_API_KEY_OPENROUTER = 'key-1'
  })

  it('aborts chat request when LLM_REQUEST_TIMEOUT_MS elapses', async () => {
    mockEnv.LLM_REQUEST_TIMEOUT_MS = '1'
    mockEnv.LLM_MIN_REQUEST_INTERVAL_MS = '0'
    vi.stubGlobal('fetch', fetchThatWaitsForAbort())
    await expect(
      llmChatCompletion({
        userId: 'u1',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    ).rejects.toThrow(/LLM request timed out after 1ms/)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('aborts embedding request when LLM_REQUEST_TIMEOUT_MS elapses', async () => {
    mockEnv.LLM_REQUEST_TIMEOUT_MS = '1'
    mockEnv.LLM_MIN_REQUEST_INTERVAL_MS = '0'
    vi.stubGlobal('fetch', fetchThatWaitsForAbort())
    await expect(llmCreateEmbeddings({ userId: 'u1', input: 'hello' })).rejects.toThrow(
      /LLM embedding request timed out after 1ms/,
    )
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('logs embedding request for a single string input', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(true, 200, { usage: { total_tokens: 2 }, data: [] })),
    )
    await llmCreateEmbeddings({ userId: 'u1', input: 'x'.repeat(120) })
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/\[llm\.embedding\] input: x+\.\.\./))
    logSpy.mockRestore()
  })

  it('logs STT response when body is empty', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(true, 200, null)),
    )
    await llmCreateTranscription({
      userId: 'u1',
      model: 'qwen/qwen3-asr-0.6b',
      audio: { bytes: new Uint8Array([1]), format: 'webm' },
    })
    expect(logSpy).toHaveBeenCalledWith('[llm.stt] response attempt 1: (empty response)')
    logSpy.mockRestore()
  })

  it('uses default 1000ms rate limit when env var is empty', async () => {
    vi.resetModules()
    vi.useFakeTimers()
    try {
      mockEnv.LLM_MIN_REQUEST_INTERVAL_MS = ''
      mockEnv.LLM_REQUEST_TIMEOUT_MS = ''
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => response(true, 200, { usage: { prompt_tokens: 1 }, choices: [] })),
      )
      const { llmChatCompletion: chat } = await import('./llm-client')
      const first = chat({ userId: 'u-rate', messages: [{ role: 'user', content: 'a' }] })
      await vi.advanceTimersByTimeAsync(0)
      const second = chat({ userId: 'u-rate', messages: [{ role: 'user', content: 'b' }] })
      await vi.advanceTimersByTimeAsync(1000)
      await first
      await second
      expect(fetch).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
