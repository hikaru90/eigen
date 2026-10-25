import { describe, expect, it } from 'vitest'
import { SECRET_PLACEHOLDER } from '$lib/server/security/detect-secrets'
import {
  ENTITY_EXTRACTION_OMIT_RULES,
  filterAcceptedEntityMentions,
  isRejectedEntitySurface,
} from './entity-mention-filter'

describe('isRejectedEntitySurface', () => {
  it('does not reject surfaces in code — LLM prompt is the judge', () => {
    expect(isRejectedEntitySurface('Hallo')).toBe(false)
    expect(isRejectedEntitySurface('Alex')).toBe(false)
  })
})

describe('filterAcceptedEntityMentions', () => {
  it('passes through all LLM mentions unchanged', () => {
    const mentions = [
      { surface: 'Hallo', entityType: 'person', confidence: 0.9 },
      { surface: 'Alex', entityType: 'person', confidence: 0.95 },
    ]
    expect(filterAcceptedEntityMentions(mentions)).toEqual(mentions)
  })
})

describe('ENTITY_EXTRACTION_OMIT_RULES', () => {
  it('tells the extraction LLM the secret marker is never an entity (the LLM is the judge, not a code filter)', () => {
    const rule = ENTITY_EXTRACTION_OMIT_RULES.find((line) => line.includes(SECRET_PLACEHOLDER))
    expect(rule).toBeDefined()
    expect(rule).toMatch(/never .*entity/i)
  })
})
