import { createHash } from 'node:crypto'

function assertSeed(seed: string): void {
  if (!seed.trim()) throw new Error('[public-bench] seed must be a non-empty string')
}

/** mulberry32 seeded from the first 32 bits of sha256(seed) — identical in every process. */
function createRng(seed: string): () => number {
  let state = createHash('sha256').update(seed).digest().readUInt32BE(0)
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher–Yates over a copy; same seed → same order, always. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  assertSeed(seed)
  const out = [...items]
  const rng = createRng(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

export function seededSample<T>(items: readonly T[], n: number, seed: string): T[] {
  if (!Number.isInteger(n) || n < 0 || n > items.length) {
    throw new Error(
      `[public-bench] sample size n must be an integer in [0, ${items.length}], got: ${n}`,
    )
  }
  return seededShuffle(items, seed).slice(0, n)
}
