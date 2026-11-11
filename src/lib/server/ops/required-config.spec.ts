import { describe, expect, it } from 'vitest'
import { assertDecisionModelConfigured } from './required-config'

const complete = {
  DECISION_SHADOW_ENABLED: 'true',
  DECISION_SHADOW_MODEL: 'typesafe/jev-1.13',
  OPENROUTER_API_KEY: 'sk-test-not-real',
}

function messageOf(fn: () => void): string {
  try {
    fn()
  } catch (e) {
    return (e as Error).message
  }
  throw new Error('expected a throw')
}

describe('assertDecisionModelConfigured', () => {
  it('throws naming all three vars when DECISION_SHADOW_ENABLED is missing', () => {
    const msg = messageOf(() => assertDecisionModelConfigured({}))
    expect(msg.startsWith('[ops] Jev decision model is not configured')).toBe(true)
    expect(msg).toContain('DECISION_SHADOW_ENABLED')
    expect(msg).toContain('DECISION_SHADOW_MODEL')
    expect(msg).toContain('OPENROUTER_API_KEY')
  })

  it('throws when DECISION_SHADOW_ENABLED is "false"', () => {
    expect(() =>
      assertDecisionModelConfigured({ ...complete, DECISION_SHADOW_ENABLED: 'false' }),
    ).toThrow('[ops] Jev decision model is not configured')
  })

  it('throws naming DECISION_SHADOW_MODEL when the model is missing', () => {
    const msg = messageOf(() =>
      assertDecisionModelConfigured({ ...complete, DECISION_SHADOW_MODEL: undefined }),
    )
    expect(msg.startsWith('[ops] Jev decision model is not configured: ')).toBe(true)
    expect(msg).toContain('DECISION_SHADOW_MODEL')
  })

  it('throws naming OPENROUTER_API_KEY when the key is missing', () => {
    const msg = messageOf(() =>
      assertDecisionModelConfigured({ ...complete, OPENROUTER_API_KEY: undefined }),
    )
    expect(msg.startsWith('[ops] Jev decision model is not configured: ')).toBe(true)
    expect(msg).toContain('OPENROUTER_API_KEY')
  })

  it('returns when the config is complete', () => {
    expect(() => assertDecisionModelConfigured(complete)).not.toThrow()
  })
})
