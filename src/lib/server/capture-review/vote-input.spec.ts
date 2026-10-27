import { describe, expect, it } from 'vitest'
import {
  CAPTURE_VOTE_PLACES,
  CAPTURE_VOTE_REASON_MAX_CHARS,
  CAPTURE_VOTE_UI_PLACES,
  CaptureVoteInputError,
  isCaptureVoteThoughtId,
  parseCaptureVoteBody,
  validateCaptureVote,
} from './vote-input'

const ID = '0b6f3f8e-5c1a-4d7e-9a2b-3c4d5e6f7a8b'

function message(fn: () => unknown): string {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(CaptureVoteInputError)
    return (err as Error).message
  }
  throw new Error('expected a CaptureVoteInputError')
}

describe('parseCaptureVoteBody (the vote boundary: exact messages, before any DB or Jev work)', () => {
  it('reads a thumbs-up', () => {
    expect(parseCaptureVoteBody({ thoughtId: ID, verdict: 'up', place: 'capture' })).toEqual({
      thoughtId: ID,
      verdict: 'up',
      place: 'capture',
      reason: undefined,
    })
  })

  it('reads a thumbs-down with a reason, trimmed', () => {
    expect(
      parseCaptureVoteBody({ thoughtId: ID, verdict: 'down', place: 'mesh', reason: '  it is Anna  ' }),
    ).toEqual({ thoughtId: ID, verdict: 'down', place: 'mesh', reason: 'it is Anna' })
  })

  it('treats an empty or blank reason as no reason', () => {
    for (const reason of ['', '   ', '\n\t']) {
      expect(
        parseCaptureVoteBody({ thoughtId: ID, verdict: 'down', place: 'capture', reason }).reason,
      ).toBeUndefined()
    }
  })

  it('accepts a blank reason with a thumbs-up (nothing to apply)', () => {
    expect(
      parseCaptureVoteBody({ thoughtId: ID, verdict: 'up', place: 'capture', reason: '  ' }).reason,
    ).toBeUndefined()
  })

  it('rejects a body that is not an object', () => {
    for (const body of [null, undefined, 'up', 3, ['up']]) {
      expect(message(() => parseCaptureVoteBody(body))).toBe('body must be a JSON object')
    }
  })

  it('rejects a thoughtId that is not a uuid', () => {
    for (const thoughtId of [undefined, '', 'abc', 12, `${ID} `, `${ID}x`, 'not-a-uuid-at-all']) {
      expect(
        message(() => parseCaptureVoteBody({ thoughtId, verdict: 'up', place: 'capture' })),
      ).toBe('thoughtId must be a uuid')
    }
  })

  it('rejects a verdict that is not up or down', () => {
    for (const verdict of [undefined, '', 'maybe', 'UP', 'Down', 1, true, null]) {
      expect(
        message(() => parseCaptureVoteBody({ thoughtId: ID, verdict, place: 'capture' })),
      ).toBe('verdict must be up or down')
    }
  })

  it('rejects a place that is not capture or mesh — the HTTP body never carries mcp', () => {
    for (const place of [undefined, '', 'yarn', 'Capture', 'both', 2, 'mcp']) {
      expect(message(() => parseCaptureVoteBody({ thoughtId: ID, verdict: 'up', place }))).toBe(
        'place must be capture or mesh',
      )
    }
  })

  it('rejects a reason that is not a string', () => {
    for (const reason of [5, true, {}, ['x']]) {
      expect(
        message(() =>
          parseCaptureVoteBody({ thoughtId: ID, verdict: 'down', place: 'capture', reason }),
        ),
      ).toBe('reason must be a string')
    }
  })

  it('rejects a reason over 2000 characters (after trimming), and accepts exactly 2000', () => {
    expect(CAPTURE_VOTE_REASON_MAX_CHARS).toBe(2000)
    const base = { thoughtId: ID, verdict: 'down', place: 'capture' }
    expect(message(() => parseCaptureVoteBody({ ...base, reason: 'a'.repeat(2001) }))).toBe(
      'reason must be at most 2000 characters',
    )
    expect(
      parseCaptureVoteBody({ ...base, reason: `  ${'a'.repeat(2000)}  ` }).reason,
    ).toHaveLength(2000)
  })

  it('rejects a reason with a thumbs-up: an up vote applies nothing', () => {
    expect(
      message(() =>
        parseCaptureVoteBody({ thoughtId: ID, verdict: 'up', place: 'capture', reason: 'but' }),
      ),
    ).toBe('reason is only allowed with verdict down')
  })

  it('checks in a fixed order: thoughtId, verdict, place, reason', () => {
    expect(message(() => parseCaptureVoteBody({ verdict: 'x', place: 'x', reason: 1 }))).toBe(
      'thoughtId must be a uuid',
    )
    expect(message(() => parseCaptureVoteBody({ thoughtId: ID, verdict: 'x', place: 'x' }))).toBe(
      'verdict must be up or down',
    )
    expect(
      message(() => parseCaptureVoteBody({ thoughtId: ID, verdict: 'down', place: 'x', reason: 1 })),
    ).toBe('place must be capture or mesh')
  })
})

describe('validateCaptureVote (the same contract for typed callers)', () => {
  it('passes a valid vote through and trims the reason', () => {
    expect(
      validateCaptureVote({ thoughtId: ID, verdict: 'down', place: 'mesh', reason: ' hmm ' }),
    ).toEqual({ thoughtId: ID, verdict: 'down', place: 'mesh', reason: 'hmm' })
  })

  it('rejects a bad typed vote with the same messages', () => {
    expect(
      message(() =>
        validateCaptureVote({
          thoughtId: ID,
          verdict: 'maybe' as never,
          place: 'capture',
          reason: undefined,
        }),
      ),
    ).toBe('verdict must be up or down')
  })
})

describe('the places of a vote', () => {
  it('names the two app places and the agent place', () => {
    expect([...CAPTURE_VOTE_UI_PLACES]).toEqual(['capture', 'mesh'])
    expect([...CAPTURE_VOTE_PLACES]).toEqual(['capture', 'mesh', 'mcp'])
  })

  it('the typed (service) contract also takes mcp: a vote from an agent over MCP', () => {
    expect(validateCaptureVote({ thoughtId: ID, verdict: 'up', place: 'mcp' })).toEqual({
      thoughtId: ID,
      verdict: 'up',
      place: 'mcp',
      reason: undefined,
    })
  })

  it('the typed contract names all three places when the place is none of them', () => {
    expect(message(() => validateCaptureVote({ thoughtId: ID, verdict: 'up', place: 'yarn' }))).toBe(
      'place must be capture, mesh or mcp',
    )
  })
})

describe('isCaptureVoteThoughtId (the thought id every capture review tool takes)', () => {
  it('is true for a uuid and false for everything else', () => {
    expect(isCaptureVoteThoughtId(ID)).toBe(true)
    for (const value of [undefined, null, '', 'abc', 12, ` ${ID}`, `${ID} `, `${ID}x`, {}]) {
      expect(isCaptureVoteThoughtId(value)).toBe(false)
    }
  })
})
