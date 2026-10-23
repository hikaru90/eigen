import { describe, expect, it } from 'vitest'
import { ECHO_DELAY_MS, pickEcho } from './capture-echo'

describe('pickEcho (the older thought this one rhymes with)', () => {
  const results = [
    { id: 'new-thought', normalizedText: 'the captured thought itself', score: 0.91 },
    { id: 'older-1', normalizedText: 'an older thought about frames', score: 0.62 },
    { id: 'older-2', normalizedText: 'another rhyme', score: 0.4 },
  ]

  it('picks the first result that is not the captured thought', () => {
    expect(pickEcho(results, 'new-thought')).toEqual({
      thoughtId: 'older-1',
      text: 'an older thought about frames',
    })
  })

  it('reads only display fields — never embedding vectors', () => {
    const picked = pickEcho(
      [{ id: 'a', normalizedText: 'text', embedding: [0.1, 0.2], vectorScore: 0.5 }],
      'new',
    )
    expect(picked).toEqual({ thoughtId: 'a', text: 'text' })
    expect(Object.keys(picked ?? {})).toEqual(['thoughtId', 'text'])
  })

  it('skips malformed rows and empty text instead of guessing', () => {
    expect(pickEcho([null, 42, { id: '', normalizedText: 'x' }], 'new')).toBeNull()
    expect(pickEcho([{ id: 'a', normalizedText: '   ' }], 'new')).toBeNull()
    expect(pickEcho([], 'new')).toBeNull()
    expect(pickEcho(undefined, 'new')).toBeNull()
  })

  it('delays the echo like ei (app.js:497): about two seconds after capture', () => {
    expect(ECHO_DELAY_MS).toBeGreaterThanOrEqual(2000)
    expect(ECHO_DELAY_MS).toBeLessThanOrEqual(3000)
  })
})
