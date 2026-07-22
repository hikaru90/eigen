import { describe, expect, it } from 'vitest'
import { hashAgentSecret } from './secret-utils'

describe('hashAgentSecret', () => {
  it('produces deterministic sha256 hex', () => {
    expect(hashAgentSecret('test')).toBe(
      '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    )
  })
})
