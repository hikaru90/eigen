import { describe, expect, it } from 'vitest'
import {
  COMMUNITY_HIERARCHY_DEPTH,
  COMMUNITY_LEAF_LEVEL,
  COMMUNITY_LEVEL_SCHEMA,
  COMMUNITY_MID_LEVEL,
  COMMUNITY_ROOT_LEVEL,
  communityLevelIntent,
  communityLevelLabel,
} from './community-levels'

describe('community-levels', () => {
  it('defines a 3-level leaf→root schema', () => {
    expect(COMMUNITY_HIERARCHY_DEPTH).toBe(3)
    expect(COMMUNITY_LEVEL_SCHEMA).toEqual([2, 1, 0])
    expect(COMMUNITY_LEAF_LEVEL).toBe(2)
    expect(COMMUNITY_MID_LEVEL).toBe(1)
    expect(COMMUNITY_ROOT_LEVEL).toBe(0)
  })

  it('labels each hierarchy level', () => {
    expect(communityLevelLabel(2)).toContain('Leaf')
    expect(communityLevelLabel(1)).toContain('Domain')
    expect(communityLevelLabel(0)).toContain('Root')
    expect(communityLevelIntent(2)).toMatch(/tight/)
  })
})
