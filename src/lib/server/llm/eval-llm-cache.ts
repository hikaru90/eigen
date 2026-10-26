import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from 'node:fs'
import { join } from 'node:path'
import { resolveHarnessBillingUserId } from '$lib/server/auth/harness-billing'

/**
 * Eval-only response cache for paid gateway calls (chat completions, embeddings, Decisions).
 * Only the eval CLI sets it (`withEvalLlmCache`); request code never does, and the gateway
 * clients honour it for harness billing users only (`evalLlmCacheFor`, same guard pattern as
 * the eval chat model and the eval clock).
 *
 * The cache is a directory of one JSON file per call, shared across runs:
 * `<dir>/<model-slug>/<key>.json`, key = sha256 of the canonical request. A response is written
 * (temp file, fsync, rename, directory fsync) BEFORE it is handed back to the caller, so a kill
 * after a paid call never loses that call. Entries are disk-only: they may hold embedding
 * responses and are never printed or logged.
 */

export type EvalLlmCacheEndpoint = 'chat' | 'embeddings' | 'decisions'

/** What identifies a call: where it went, and the exact request body that was sent. */
export type EvalLlmCacheRequest = {
  endpoint: EvalLlmCacheEndpoint
  provider: string
  model: string
  body: unknown
}

export type EvalLlmCacheEntry = {
  version: 1
  key: string
  endpoint: EvalLlmCacheEndpoint
  provider: string
  model: string
  /** Provider-reported USD of the call when it was paid (0 when the gateway reported none). */
  costUsd: number
  /** The raw gateway response body. */
  response: unknown
  storedAt: string
}

export type EvalLlmCacheStats = {
  hits: number
  /** Paid calls (a call that missed the cache and went to the gateway). */
  misses: number
  usdPaid: number
  usdAvoided: number
}

export type EvalLlmCacheEvent = {
  kind: 'hit' | 'paid'
  endpoint: EvalLlmCacheEndpoint
  usd: number
}

export type EvalLlmCache = {
  dir: string
  stats: EvalLlmCacheStats
  lookup(request: EvalLlmCacheRequest): EvalLlmCacheEntry | undefined
  /** Persists the response durably; returns only after the file is renamed into place. */
  store(request: EvalLlmCacheRequest, value: { response: unknown; costUsd: number }): void
  noteHit(endpoint: EvalLlmCacheEndpoint, usd: number): void
  notePaid(endpoint: EvalLlmCacheEndpoint, usd: number): void
}

/** JSON with object keys sorted recursively; arrays keep their order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key])
    }
    return out
  }
  return value
}

export function evalLlmCacheKey(request: EvalLlmCacheRequest): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        endpoint: request.endpoint,
        provider: request.provider,
        model: request.model,
        body: request.body,
      }),
    )
    .digest('hex')
}

/** Directory fragment for a model id (`vendor/name` -> `vendor-name`); id formatting only. */
function modelDirName(model: string): string {
  const slug = model.toLowerCase().replace(/[^a-z0-9.-]+/g, '-')
  if (!slug.replace(/-/g, ''))
    throw new Error(`[eval-llm-cache] model "${model}" yields an empty directory name`)
  return slug
}

function fsyncDirectory(path: string): void {
  const fd = openSync(path, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

let tempCounter = 0

function writeFileDurably(path: string, content: string): void {
  const temp = `${path}.tmp-${process.pid}-${tempCounter++}`
  const fd = openSync(temp, 'w')
  try {
    writeSync(fd, content)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(temp, path)
}

export function createEvalLlmCache(
  dir: string,
  onEvent?: (event: EvalLlmCacheEvent) => void,
): EvalLlmCache {
  if (!dir.trim()) throw new Error('[eval-llm-cache] the cache directory must be non-empty')
  const stats: EvalLlmCacheStats = { hits: 0, misses: 0, usdPaid: 0, usdAvoided: 0 }
  const pathFor = (request: EvalLlmCacheRequest, key: string) =>
    join(dir, modelDirName(request.model), `${key}.json`)

  return {
    dir,
    stats,
    lookup(request) {
      const key = evalLlmCacheKey(request)
      const path = pathFor(request, key)
      if (!existsSync(path)) return undefined
      let entry: EvalLlmCacheEntry
      try {
        entry = JSON.parse(readFileSync(path, 'utf8')) as EvalLlmCacheEntry
      } catch (err) {
        throw new Error(
          `[eval-llm-cache] corrupt cache entry ${path}: ${err instanceof Error ? err.message : err}`,
          {
            cause: err,
          },
        )
      }
      if (entry.version !== 1 || entry.key !== key) {
        throw new Error(
          `[eval-llm-cache] cache entry ${path} does not match its key (delete the file)`,
        )
      }
      return entry
    },
    store(request, value) {
      const key = evalLlmCacheKey(request)
      const path = pathFor(request, key)
      const entry: EvalLlmCacheEntry = {
        version: 1,
        key,
        endpoint: request.endpoint,
        provider: request.provider,
        model: request.model,
        costUsd: value.costUsd,
        response: value.response,
        storedAt: new Date().toISOString(),
      }
      const modelDir = join(dir, modelDirName(request.model))
      mkdirSync(modelDir, { recursive: true })
      writeFileDurably(path, JSON.stringify(entry))
      fsyncDirectory(modelDir)
    },
    noteHit(endpoint, usd) {
      stats.hits += 1
      stats.usdAvoided += usd
      onEvent?.({ kind: 'hit', endpoint, usd })
    },
    notePaid(endpoint, usd) {
      stats.misses += 1
      stats.usdPaid += usd
      onEvent?.({ kind: 'paid', endpoint, usd })
    },
  }
}

const evalLlmCacheAsyncLocal = new AsyncLocalStorage<EvalLlmCache>()

export function withEvalLlmCache<T>(
  cache: EvalLlmCache | string,
  fn: () => Promise<T>,
): Promise<T> {
  const resolved = typeof cache === 'string' ? createEvalLlmCache(cache) : cache
  return evalLlmCacheAsyncLocal.run(resolved, fn)
}

export function currentEvalLlmCache(): EvalLlmCache | undefined {
  return evalLlmCacheAsyncLocal.getStore()
}

/** The cache for `userId`, or undefined when none is set. Throws if set for a non-harness user. */
export function evalLlmCacheFor(userId: string | undefined): EvalLlmCache | undefined {
  const cache = currentEvalLlmCache()
  if (cache === undefined) return undefined
  if (userId === undefined || resolveHarnessBillingUserId(userId) === undefined) {
    throw new Error(
      `Eval LLM cache "${cache.dir}" is only allowed for harness billing users, not "${userId ?? '(no user)'}"`,
    )
  }
  return cache
}
