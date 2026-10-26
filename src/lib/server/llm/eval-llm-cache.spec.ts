import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  canonicalJson,
  createEvalLlmCache,
  currentEvalLlmCache,
  evalLlmCacheFor,
  evalLlmCacheKey,
  withEvalLlmCache,
} from './eval-llm-cache'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'eval-llm-cache-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const request = {
  endpoint: 'chat' as const,
  provider: 'openrouter',
  model: 'deepseek/deepseek-v4.1-flash-1017',
  body: {
    model: 'deepseek/deepseek-v4.1-flash-1017',
    messages: [{ role: 'user', content: 'hello' }],
    temperature: 0,
    max_tokens: 8192,
    response_format: { type: 'json_object' },
  },
}

describe('canonicalJson', () => {
  it('sorts object keys recursively and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 2], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,2]},"b":1}',
    )
  })

  it('drops undefined properties like JSON.stringify does', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}')
  })
})

describe('evalLlmCacheKey', () => {
  it('is a sha256 hex digest independent of key order', () => {
    const reordered = {
      ...request,
      body: {
        response_format: { type: 'json_object' },
        max_tokens: 8192,
        temperature: 0,
        messages: [{ content: 'hello', role: 'user' }],
        model: 'deepseek/deepseek-v4.1-flash-1017',
      },
    }
    const key = evalLlmCacheKey(request)
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(evalLlmCacheKey(reordered)).toBe(key)
  })

  it.each([
    ['endpoint', { ...request, endpoint: 'embeddings' as const }],
    ['provider', { ...request, provider: 'other' }],
    ['model', { ...request, model: 'openai/gpt-4o-mini' }],
    [
      'message',
      { ...request, body: { ...request.body, messages: [{ role: 'user', content: 'hallo' }] } },
    ],
    ['temperature', { ...request, body: { ...request.body, temperature: 0.5 } }],
    ['max_tokens', { ...request, body: { ...request.body, max_tokens: 1 } }],
    ['response_format', { ...request, body: { ...request.body, response_format: undefined } }],
  ])('changes when the %s changes', (_name, other) => {
    expect(evalLlmCacheKey(other)).not.toBe(evalLlmCacheKey(request))
  })
})

describe('cache entries', () => {
  it('store writes <dir>/<model-slug>/<key>.json before returning, leaving no temp file', () => {
    const cache = createEvalLlmCache(dir)
    const response = { choices: [{ message: { content: 'hi' } }], usage: { cost: 0.001 } }
    cache.store(request, { response, costUsd: 0.001 })
    const key = evalLlmCacheKey(request)
    const files = readdirSync(join(dir, 'deepseek-deepseek-v4.1-flash-1017'))
    expect(files).toEqual([`${key}.json`])
    const onDisk = JSON.parse(
      readFileSync(join(dir, 'deepseek-deepseek-v4.1-flash-1017', `${key}.json`), 'utf8'),
    )
    expect(onDisk).toMatchObject({ version: 1, key, endpoint: 'chat', costUsd: 0.001, response })
  })

  it('lookup returns the stored response and undefined for a miss', () => {
    const cache = createEvalLlmCache(dir)
    expect(cache.lookup(request)).toBeUndefined()
    cache.store(request, { response: { ok: true }, costUsd: 0.5 })
    expect(cache.lookup(request)).toMatchObject({ response: { ok: true }, costUsd: 0.5 })
  })

  it('a second cache object over the same directory sees the entry (shared across runs)', () => {
    createEvalLlmCache(dir).store(request, { response: { n: 1 }, costUsd: 0 })
    expect(createEvalLlmCache(dir).lookup(request)?.response).toEqual({ n: 1 })
  })

  it('fails loud on an entry that does not belong to its key', () => {
    const cache = createEvalLlmCache(dir)
    cache.store(request, { response: { n: 1 }, costUsd: 0 })
    const key = evalLlmCacheKey(request)
    const file = join(dir, 'deepseek-deepseek-v4.1-flash-1017', `${key}.json`)
    writeFileSync(file, JSON.stringify({ version: 1, key: 'f'.repeat(64), response: {} }))
    expect(() => cache.lookup(request)).toThrow(/does not match/)
  })

  it('fails loud on an unparseable entry', () => {
    const cache = createEvalLlmCache(dir)
    cache.store(request, { response: { n: 1 }, costUsd: 0 })
    const key = evalLlmCacheKey(request)
    writeFileSync(join(dir, 'deepseek-deepseek-v4.1-flash-1017', `${key}.json`), '{"torn')
    expect(() => cache.lookup(request)).toThrow(/corrupt/)
  })

  it('counts hits, misses and USD paid / avoided and emits an event per call', () => {
    const events: unknown[] = []
    const cache = createEvalLlmCache(dir, (event) => events.push(event))
    cache.notePaid('chat', 0.25)
    cache.noteHit('chat', 0.25)
    cache.noteHit('embeddings', 0.0001)
    expect(cache.stats).toEqual({ hits: 2, misses: 1, usdPaid: 0.25, usdAvoided: 0.2501 })
    expect(events).toEqual([
      { kind: 'paid', endpoint: 'chat', usd: 0.25 },
      { kind: 'hit', endpoint: 'chat', usd: 0.25 },
      { kind: 'hit', endpoint: 'embeddings', usd: 0.0001 },
    ])
  })
})

describe('withEvalLlmCache / evalLlmCacheFor', () => {
  it('is unset outside the scope and set inside it', async () => {
    expect(currentEvalLlmCache()).toBeUndefined()
    const cache = createEvalLlmCache(dir)
    await withEvalLlmCache(cache, async () => {
      expect(currentEvalLlmCache()).toBe(cache)
    })
    expect(currentEvalLlmCache()).toBeUndefined()
  })

  it('a directory string creates a cache', async () => {
    await withEvalLlmCache(dir, async () => {
      expect(currentEvalLlmCache()?.dir).toBe(dir)
    })
  })

  it('returns the cache for a harness billing user', async () => {
    const cache = createEvalLlmCache(dir)
    await withEvalLlmCache(cache, async () => {
      expect(evalLlmCacheFor('public-bench-personamem-v2-capture-x-p1')).toBe(cache)
    })
  })

  it('refuses a user that is not a harness billing user', async () => {
    await withEvalLlmCache(dir, async () => {
      expect(() => evalLlmCacheFor('real-user-42')).toThrow(
        /only allowed for harness billing users/,
      )
    })
  })

  it('is undefined (cache off) for any user when no cache is set', () => {
    expect(evalLlmCacheFor('real-user-42')).toBeUndefined()
  })

  it('refuses a blank directory', () => {
    expect(() => createEvalLlmCache('  ')).toThrow(/directory/)
  })
})
