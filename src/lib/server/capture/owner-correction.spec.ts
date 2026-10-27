import { describe, expect, it } from 'vitest'
import { ownerCorrectionBlock } from './owner-correction'

describe('ownerCorrectionBlock', () => {
  it('says the last reading was wrong, quotes the trimmed correction and asks for a new reading', () => {
    expect(ownerCorrectionBlock('  wrong day, I said Friday ')).toBe(
      'The owner said the last reading of this thought was wrong: "wrong day, I said Friday". Read the thought again with that in mind.',
    )
  })

  it('refuses a blank correction', () => {
    expect(() => ownerCorrectionBlock('  \n')).toThrow(/must not be blank/)
  })
})
