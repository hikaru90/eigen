import { describe, expect, it } from 'vitest'
import { mergeBelowFloor } from './below-floor'

describe('mergeBelowFloor', () => {
  it('is null on both sides when nothing was observed (e.g. Ask never called answer_question)', () => {
    expect(mergeBelowFloor([])).toEqual({ thoughts: null, notePassages: null })
  })

  it('takes the best score per side over every compose call, ignoring sides that dropped nothing', () => {
    expect(
      mergeBelowFloor([
        { thoughts: 0.1, notePassages: null },
        { thoughts: 0.19, notePassages: 0.05 },
        { thoughts: null, notePassages: 0.12 },
      ]),
    ).toEqual({ thoughts: 0.19, notePassages: 0.12 })
  })

  it('keeps a legitimate score of 0', () => {
    expect(mergeBelowFloor([{ thoughts: 0, notePassages: null }])).toEqual({
      thoughts: 0,
      notePassages: null,
    })
  })
})
