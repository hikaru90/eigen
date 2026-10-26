import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExtendedPrivateEnv } from '$lib/server/env/private-env'
import {
  createEvalLlmCache,
  evictEvalLlmCacheEntry,
  evictOnReject,
  withEvalLlmCache,
} from './eval-llm-cache'
import { llmChatCompletion, llmCreateEmbeddings } from './llm-client'

const { mockEnv, logActivityCallMock, chargeMock, billingCalls } = vi.hoisted(() => ({
  mockEnv: {
    LLM_MIN_REQUEST_INTERVAL_MS: '0',
    LLM_REQUEST_TIMEOUT_MS: '',
    LLM_SERIAL_REQUESTS: '',
    OPENROUTER_BASE_URL: 'https://openrouter.example/api/v1',
    SERVICE_API_KEY_OPENROUTER: 'service-openrouter-key',
  } as ExtendedPrivateEnv,
  logActivityCallMock: vi.fn(),
  chargeMock: vi.fn(),
  billingCalls: { count: 0 },
}))

vi.mock('$lib/server/env/private-env', () => ({ env: mockEnv }))
vi.mock('$lib/server/db', () => ({ getDb: () => ({}) }))
vi.mock('$lib/server/activity/log-call', () => ({ logActivityCall: logActivityCallMock }))
vi.mock('$lib/server/analytics/posthog-server', () => ({ captureServerEvent: vi.fn() }))
// the real usage gate, minus the database: settle from the call result, then debit the wallet
vi.mock('$lib/server/billing/usage-gate', () => ({
  withPlatformBilling: vi.fn(
    async (_userId: string, settle: (result: unknown) => number, fn: () => Promise<unknown>) => {
      billingCalls.count += 1
      const result = await fn()
      chargeMock(settle(result))
      return result
    },
  ),
}))

const MODEL_DIR = 'deepseek-deepseek-v4.1-flash-1017'
const TENANT = 'public-bench-personamem-v2-capture-test-p1'

function ok(body: unknown): Response {
  return { ok: true, status: 200, text: async () => JSON.stringify(body) } as unknown as Response
}

const chatBody = { choices: [{ message: { content: '{"letter":"A"}' } }], usage: { cost: 0.004 } }
const embeddingBody = { data: [{ embedding: [0.1] }], usage: { cost: 0.0002 } }

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'llm-client-cache-'))
  vi.clearAllMocks()
  chargeMock.mockReset()
  billingCalls.count = 0
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

const chat = (content = 'hello') =>
  llmChatCompletion({
    userId: TENANT,
    messages: [{ role: 'user', content }],
    temperature: 0,
    responseFormat: 'json_object',
  })

describe('llmChatCompletion with the eval cache', () => {
  it('a miss pays once, writes the response before the wallet is debited, and counts as paid', async () => {
    const fetchMock = vi.fn(async () => ok(chatBody))
    vi.stubGlobal('fetch', fetchMock)
    const cache = createEvalLlmCache(dir)
    let filesWhenDebited = -1
    chargeMock.mockImplementation(() => {
      filesWhenDebited = readdirSync(join(dir, MODEL_DIR)).length
    })

    const result = await withEvalLlmCache(cache, () => chat())

    expect(result).toEqual(chatBody)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(billingCalls.count).toBe(1)
    expect(filesWhenDebited).toBe(1)
    expect(cache.stats).toMatchObject({ hits: 0, misses: 1, usdPaid: 0.004 })
  })

  it('a hit returns the stored response with no gateway call, no wallet work and a 0-USD cached log row', async () => {
    const fetchMock = vi.fn(async () => ok(chatBody))
    vi.stubGlobal('fetch', fetchMock)
    const cache = createEvalLlmCache(dir)
    await withEvalLlmCache(cache, () => chat())
    fetchMock.mockClear()
    logActivityCallMock.mockClear()
    billingCalls.count = 0
    chargeMock.mockClear()

    const again = await withEvalLlmCache(cache, () => chat())

    expect(again).toEqual(chatBody)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(billingCalls.count).toBe(0)
    expect(chargeMock).not.toHaveBeenCalled()
    expect(logActivityCallMock).toHaveBeenCalledTimes(1)
    expect(logActivityCallMock).toHaveBeenCalledWith(
      expect.anything(),
      TENANT,
      expect.objectContaining({
        operation: 'llm.chat.chat.cache_hit',
        baseCostUsd: 0,
        cached: true,
      }),
    )
    expect(cache.stats).toMatchObject({ hits: 1, misses: 1, usdPaid: 0.004, usdAvoided: 0.004 })
  })

  it('a different prompt is a different call', async () => {
    const fetchMock = vi.fn(async () => ok(chatBody))
    vi.stubGlobal('fetch', fetchMock)
    const cache = createEvalLlmCache(dir)
    await withEvalLlmCache(cache, async () => {
      await chat('one')
      await chat('two')
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(cache.stats.hits).toBe(0)
  })

  it('does not cache a response the wallet would refuse (no reported cost)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok({ choices: [] })),
    )
    const cache = createEvalLlmCache(dir)
    await expect(withEvalLlmCache(cache, () => chat())).rejects.toThrow(/missing usage.cost/)
    expect(existsSync(join(dir, MODEL_DIR))).toBe(false)
    expect(cache.stats.misses).toBe(0)
  })

  it('is off without a cache: always the gateway, always billed', async () => {
    const fetchMock = vi.fn(async () => ok(chatBody))
    vi.stubGlobal('fetch', fetchMock)
    await chat()
    await chat()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(billingCalls.count).toBe(2)
  })

  it('refuses a cache for a user that is not a harness billing user', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok(chatBody)),
    )
    await expect(
      withEvalLlmCache(createEvalLlmCache(dir), () =>
        llmChatCompletion({ userId: 'real-user', messages: [{ role: 'user', content: 'x' }] }),
      ),
    ).rejects.toThrow(/only allowed for harness billing users/)
  })
})

function chatReply(content: string) {
  return { choices: [{ message: { content } }], usage: { cost: 0.004 } }
}

const freeTextChat = () =>
  llmChatCompletion({ userId: TENANT, messages: [{ role: 'user', content: 'hello' }] })

describe('llmChatCompletion eval cache: only usable responses are stored', () => {
  const prose = chatReply('Please paste the text you want help with.')

  it('does not store a json_object response whose content is not JSON, but still bills it', async () => {
    const fetchMock = vi.fn(async () => ok(prose))
    vi.stubGlobal('fetch', fetchMock)
    const cache = createEvalLlmCache(dir)

    const result = await withEvalLlmCache(cache, () => chat())

    expect(result).toEqual(prose)
    expect(existsSync(join(dir, MODEL_DIR))).toBe(false)
    expect(chargeMock).toHaveBeenCalledWith(0.004)
    expect(cache.stats).toMatchObject({ hits: 0, misses: 1, usdPaid: 0.004 })
  })

  it('asks the model again on the next identical json_object request after a prose answer', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(prose))
      .mockResolvedValueOnce(ok(chatReply('{"mentions":[]}')))
    vi.stubGlobal('fetch', fetchMock)
    const cache = createEvalLlmCache(dir)

    const first = await withEvalLlmCache(cache, () => chat())
    const second = await withEvalLlmCache(cache, () => chat())

    expect(first).toEqual(prose)
    expect(second).toEqual(chatReply('{"mentions":[]}'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(cache.stats.hits).toBe(0)
  })

  it('does not store an empty json_object answer or one without message content', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(chatReply('')))
      .mockResolvedValueOnce(ok({ choices: [], usage: { cost: 0.004 } }))
    vi.stubGlobal('fetch', fetchMock)
    const cache = createEvalLlmCache(dir)

    await withEvalLlmCache(cache, async () => {
      await chat()
      await chat()
    })

    expect(existsSync(join(dir, MODEL_DIR))).toBe(false)
  })

  it.each(['{"a":1}', '[]', '```json\n{"a":1}\n```', '0', 'null'])(
    'stores a json_object answer that parses as JSON (%s)',
    async (content) => {
      const fetchMock = vi.fn(async () => ok(chatReply(content)))
      vi.stubGlobal('fetch', fetchMock)
      const cache = createEvalLlmCache(dir)

      await withEvalLlmCache(cache, async () => {
        await chat()
        await chat()
      })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(cache.stats).toMatchObject({ hits: 1, misses: 1 })
    },
  )

  it('keeps caching free-text answers (no json_object requested)', async () => {
    const fetchMock = vi.fn(async () => ok(prose))
    vi.stubGlobal('fetch', fetchMock)
    const cache = createEvalLlmCache(dir)

    await withEvalLlmCache(cache, async () => {
      await freeTextChat()
      await freeTextChat()
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(cache.stats).toMatchObject({ hits: 1, misses: 1 })
  })

  it('never stores an HTTP error', async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: false,
          status: 400,
          text: async () => JSON.stringify({ error: { message: 'bad request' } }),
        }) as unknown as Response,
    )
    vi.stubGlobal('fetch', fetchMock)
    const cache = createEvalLlmCache(dir)

    await expect(withEvalLlmCache(cache, () => chat())).rejects.toThrow(/bad request/)

    expect(existsSync(join(dir, MODEL_DIR))).toBe(false)
    expect(cache.stats.misses).toBe(0)
  })
})

describe('evictEvalLlmCacheEntry: a caller that rejects a response makes the retry ask again', () => {
  it('drops the entry of a stored response so the identical request reaches the gateway again', async () => {
    const bad = chatReply('{"unexpected":"shape"}')
    const good = chatReply('{"letter":"A"}')
    const fetchMock = vi.fn().mockResolvedValueOnce(ok(bad)).mockResolvedValueOnce(ok(good))
    vi.stubGlobal('fetch', fetchMock)
    const cache = createEvalLlmCache(dir)

    await withEvalLlmCache(cache, async () => {
      const first = await chat()
      expect(evictEvalLlmCacheEntry(first)).toBe(true)
      expect(await chat()).toEqual(good)
      // the replacement is what future identical requests now hit
      expect(await chat()).toEqual(good)
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(cache.stats).toMatchObject({ hits: 1, misses: 2 })
  })

  it('also evicts a response that was served from the cache', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(chatReply('{"v":1}')))
      .mockResolvedValueOnce(ok(chatReply('{"v":2}')))
    vi.stubGlobal('fetch', fetchMock)
    const cache = createEvalLlmCache(dir)

    await withEvalLlmCache(cache, async () => {
      await chat()
      const hit = await chat()
      expect(evictEvalLlmCacheEntry(hit)).toBe(true)
      expect(await chat()).toEqual(chatReply('{"v":2}'))
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('is a no-op for a response that never came from the cache (and for non-objects)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok(chatBody)),
    )
    const uncached = await chat()
    expect(evictEvalLlmCacheEntry(uncached)).toBe(false)
    expect(evictEvalLlmCacheEntry({ choices: [] })).toBe(false)
    expect(evictEvalLlmCacheEntry('text')).toBe(false)
    expect(evictEvalLlmCacheEntry(undefined)).toBe(false)
  })

  it('returns false when the entry is already gone', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok(chatBody)),
    )
    const cache = createEvalLlmCache(dir)
    await withEvalLlmCache(cache, async () => {
      const first = await chat()
      expect(evictEvalLlmCacheEntry(first)).toBe(true)
      expect(evictEvalLlmCacheEntry(first)).toBe(false)
    })
  })
})

describe('llmCreateEmbeddings with the eval cache', () => {
  it('a hit costs nothing and keeps the vectors out of the log row', async () => {
    const fetchMock = vi.fn(async () => ok(embeddingBody))
    vi.stubGlobal('fetch', fetchMock)
    const cache = createEvalLlmCache(dir)
    await withEvalLlmCache(cache, () => llmCreateEmbeddings({ userId: TENANT, input: 'hello' }))
    fetchMock.mockClear()
    logActivityCallMock.mockClear()
    billingCalls.count = 0

    const again = await withEvalLlmCache(cache, () =>
      llmCreateEmbeddings({ userId: TENANT, input: 'hello' }),
    )

    expect(again).toEqual(embeddingBody)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(billingCalls.count).toBe(0)
    expect(logActivityCallMock).toHaveBeenCalledWith(
      expect.anything(),
      TENANT,
      expect.objectContaining({
        operation: 'llm.embedding.cache_hit',
        baseCostUsd: 0,
        cached: true,
      }),
    )
    expect(JSON.stringify(logActivityCallMock.mock.calls)).not.toContain('0.1')
    expect(cache.stats).toMatchObject({ hits: 1, misses: 1 })
  })

  it('a different input is a different call', async () => {
    const fetchMock = vi.fn(async () => ok(embeddingBody))
    vi.stubGlobal('fetch', fetchMock)
    const cache = createEvalLlmCache(dir)
    await withEvalLlmCache(cache, async () => {
      await llmCreateEmbeddings({ userId: TENANT, input: 'a' })
      await llmCreateEmbeddings({ userId: TENANT, input: ['a', 'b'] })
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('evictOnReject: a parse that throws drops the reply it was parsing', () => {
  const twoReplies = () =>
    vi
      .fn()
      .mockResolvedValueOnce(ok(chatReply('{"unexpected":"shape"}')))
      .mockResolvedValueOnce(ok(chatReply('{"letter":"A"}')))

  it('evicts on a sync throw and rethrows the same error', async () => {
    const fetchMock = twoReplies()
    vi.stubGlobal('fetch', fetchMock)
    const failure = new Error('wrong shape')

    await withEvalLlmCache(createEvalLlmCache(dir), async () => {
      const first = await chat()
      expect(() =>
        evictOnReject(first, () => {
          throw failure
        }),
      ).toThrow(failure)
      expect(await chat()).toEqual(chatReply('{"letter":"A"}'))
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('evicts on an async rejection and rethrows the same error', async () => {
    const fetchMock = twoReplies()
    vi.stubGlobal('fetch', fetchMock)
    const failure = new Error('wrong shape')

    await withEvalLlmCache(createEvalLlmCache(dir), async () => {
      const first = await chat()
      await expect(evictOnReject(first, async () => Promise.reject(failure))).rejects.toBe(failure)
      expect(await chat()).toEqual(chatReply('{"letter":"A"}'))
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps the entry and returns the value when the parse succeeds', async () => {
    const fetchMock = vi.fn(async () => ok(chatBody))
    vi.stubGlobal('fetch', fetchMock)

    await withEvalLlmCache(createEvalLlmCache(dir), async () => {
      const first = await chat()
      expect(evictOnReject(first, () => 'parsed')).toBe('parsed')
      await expect(evictOnReject(first, async () => 42)).resolves.toBe(42)
      await chat()
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('is a no-op without an eval cache: the error still propagates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok(chatBody)),
    )
    const uncached = await chat()
    const failure = new Error('wrong shape')

    expect(() =>
      evictOnReject(uncached, () => {
        throw failure
      }),
    ).toThrow(failure)
  })
})
