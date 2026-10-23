import { describe, expect, it } from 'vitest'
import { keepOutcomeFromResponse } from './keep-outcome'

describe('keepOutcomeFromResponse (exactly-one-row guard after POST /api/capture/keep)', () => {
  it('a 2xx with a thoughtId means the row is kept', () => {
    expect(keepOutcomeFromResponse(true, 200, { thoughtId: 't-1' })).toEqual({
      kind: 'kept',
      thoughtId: 't-1',
    })
  })

  it('a 2xx with a malformed body is STILL kept — the words must never be restored for a resubmit', () => {
    expect(keepOutcomeFromResponse(true, 200, {})).toEqual({ kind: 'kept', thoughtId: null })
    expect(keepOutcomeFromResponse(true, 200, null)).toEqual({ kind: 'kept', thoughtId: null })
    expect(keepOutcomeFromResponse(true, 200, { thoughtId: 42 })).toEqual({
      kind: 'kept',
      thoughtId: null,
    })
    expect(keepOutcomeFromResponse(true, 200, { thoughtId: '  ' })).toEqual({
      kind: 'kept',
      thoughtId: null,
    })
  })

  it('a non-2xx means nothing was kept — the words may go back into the field', () => {
    expect(keepOutcomeFromResponse(false, 402, { error: 'Insufficient credits' })).toEqual({
      kind: 'not-kept',
      status: 402,
      message: 'Insufficient credits',
    })
    expect(keepOutcomeFromResponse(false, 500, { message: 'reading.category.key must be a non-empty string' })).toEqual({
      kind: 'not-kept',
      status: 500,
      message: 'reading.category.key must be a non-empty string',
    })
  })

  it('prefers the server message over error, and reports null when the server said nothing', () => {
    expect(keepOutcomeFromResponse(false, 500, { message: 'm', error: 'e' })).toEqual({
      kind: 'not-kept',
      status: 500,
      message: 'm',
    })
    expect(keepOutcomeFromResponse(false, 503, {})).toEqual({
      kind: 'not-kept',
      status: 503,
      message: null,
    })
    expect(keepOutcomeFromResponse(false, 503, 'not json')).toEqual({
      kind: 'not-kept',
      status: 503,
      message: null,
    })
  })
})
