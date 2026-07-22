import { describe, expect, it } from 'vitest'
import { filterAcceptedEntityMentions, isRejectedEntitySurface } from './entity-mention-filter'

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
