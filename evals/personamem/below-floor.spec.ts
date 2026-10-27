import { describe, expect, it } from 'vitest'
import { mergeBelowFloor } from './below-floor'

describe('mergeBelowFloor', () => {
  it('is null when nothing was observed (e.g. Ask never called answer_question)', () => {
    expect(mergeBelowFloor([])).toEqual({ thoughts: null })
  })

  it('takes the best score over every compose call, ignoring calls that dropped nothing', () => {
    expect(
      mergeBelowFloor([{ thoughts: 0.1 }, { thoughts: 0.19 }, { thoughts: null }]),
    ).toEqual({ thoughts: 0.19 })
  })

  it('keeps a legitimate score of 0', () => {
    expect(mergeBelowFloor([{ thoughts: 0 }])).toEqual({ thoughts: 0 })
  })
})
