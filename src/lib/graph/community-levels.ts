/**
 * Client-safe community hierarchy constants (mirrors server community-levels.ts).
 * L2 = leaf (tightest), L1 = domain, L0 = root (broadest).
 */
export const COMMUNITY_LEVEL_SCHEMA = [2, 1, 0] as const

export type CommunityDbLevel = (typeof COMMUNITY_LEVEL_SCHEMA)[number]

export const COMMUNITY_LEAF_LEVEL = COMMUNITY_LEVEL_SCHEMA[0]
export const COMMUNITY_ROOT_LEVEL = COMMUNITY_LEVEL_SCHEMA[COMMUNITY_LEVEL_SCHEMA.length - 1]

export function isCommunityDbLevel(level: number): level is CommunityDbLevel {
  return (COMMUNITY_LEVEL_SCHEMA as readonly number[]).includes(level)
}

export function communityLevelFilterLabel(level: number): string {
  if (level === COMMUNITY_LEAF_LEVEL) return 'L2 leaf (tightest)'
  if (level === 1) return 'L1 domain'
  return 'L0 root'
}

/** Leaf → root order, keeping only levels present in data. */
export function canonicalCommunityLevels(levelsInData: ReadonlyArray<number>): CommunityDbLevel[] {
  const present = new Set(levelsInData)
  return COMMUNITY_LEVEL_SCHEMA.filter((level) => present.has(level))
}
