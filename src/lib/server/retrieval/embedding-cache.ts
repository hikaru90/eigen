import { createHash } from 'node:crypto'

const CACHE_TTL_MS = 5 * 60 * 1000
const CACHE_MAX_ENTRIES = 256

type CacheEntry = {
  embedding: number[]
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

function cacheKey(userId: string, normalizedQuery: string): string {
  const hash = createHash('sha256').update(normalizedQuery).digest('hex')
  return `${userId}:${hash}`
}

function normalizeQueryForCache(query: string): string {
  return query.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
}

function evictExpired(): void {
  const now = Date.now()
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key)
  }
}

function evictOldestIfNeeded(): void {
  if (cache.size <= CACHE_MAX_ENTRIES) return
  const first = cache.keys().next().value
  if (first) cache.delete(first)
}

export function getCachedQueryEmbedding(userId: string, query: string): number[] | undefined {
  evictExpired()
  const entry = cache.get(cacheKey(userId, normalizeQueryForCache(query)))
  if (!entry || entry.expiresAt <= Date.now()) return undefined
  return entry.embedding
}

export function setCachedQueryEmbedding(userId: string, query: string, embedding: number[]): void {
  evictExpired()
  evictOldestIfNeeded()
  cache.set(cacheKey(userId, normalizeQueryForCache(query)), {
    embedding,
    expiresAt: Date.now() + CACHE_TTL_MS,
  })
}

/** Test-only: clear in-process cache between specs. */
export function clearQueryEmbeddingCacheForTests(): void {
  cache.clear()
}
