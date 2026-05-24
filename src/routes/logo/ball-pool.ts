import type { BallAnchor } from "./metaball-interaction";

/** Deterministic shuffle: same layout → same hide order when reducing visible %. */
export function computeRemovalOrder(anchors: BallAnchor[]): number[] {
  const n = anchors.length;
  const indices = Array.from({ length: n }, (_, i) => i);
  if (n <= 1) return indices;

  let seed = 2166136261;
  for (const a of anchors) {
    seed ^= Math.imul(Math.floor(a.x * 1000) | 0, 16777619);
    seed ^= Math.imul(Math.floor(a.y * 1000) | 0, 2166136261);
    seed ^= Math.imul(Math.floor(a.r * 100) | 0, 2246822519);
    seed = Math.imul(seed, 16777619);
  }

  let t = seed >>> 0;
  const rand = () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };

  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}

export function visibleFromPool(
  pool: BallAnchor[],
  removalOrder: number[],
  visibleCount: number,
): { anchors: BallAnchor[]; poolIndices: number[] } {
  const poolSize = pool.length;
  if (poolSize === 0) return { anchors: [], poolIndices: [] };

  const n = Math.min(poolSize, Math.max(0, Math.floor(visibleCount)));
  const hideCount = poolSize - n;
  const hidden = new Set(removalOrder.slice(0, hideCount));
  const anchors: BallAnchor[] = [];
  const poolIndices: number[] = [];

  for (let i = 0; i < poolSize; i++) {
    if (!hidden.has(i)) {
      anchors.push(pool[i]);
      poolIndices.push(i);
    }
  }

  return { anchors, poolIndices };
}

export function remapRemovalOrderAfterPoolIndexRemoved(
  removalOrder: number[],
  removedPoolIndex: number,
): number[] {
  return removalOrder
    .filter((i) => i !== removedPoolIndex)
    .map((i) => (i > removedPoolIndex ? i - 1 : i));
}
