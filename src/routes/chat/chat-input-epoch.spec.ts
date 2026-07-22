import { describe, expect, it } from 'vitest'
import { bumpInputEpoch, createInputEpoch, isFreshTranscript } from './chat-input-epoch'

describe('chat-input-epoch', () => {
  it('starts at zero', () => {
    const epoch = createInputEpoch()
    expect(epoch.current).toBe(0)
  })

  it('bumps monotonically and returns the new value', () => {
    const epoch = createInputEpoch()
    expect(bumpInputEpoch(epoch)).toBe(1)
    expect(bumpInputEpoch(epoch)).toBe(2)
    expect(bumpInputEpoch(epoch)).toBe(3)
  })

  it('treats a transcript as fresh when no submit has bumped the epoch since record-start', () => {
    const epoch = createInputEpoch()
    const recordedAt = bumpInputEpoch(epoch) // recording starts
    expect(isFreshTranscript(epoch, recordedAt)).toBe(true)
  })

  it('drops a transcript after a submit bumps the epoch', () => {
    const epoch = createInputEpoch()
    const recordedAt = bumpInputEpoch(epoch) // recording starts
    bumpInputEpoch(epoch) // submit happens
    expect(isFreshTranscript(epoch, recordedAt)).toBe(false)
  })

  it('treats a new recording as fresh again after a new record-start bump', () => {
    const epoch = createInputEpoch()
    const firstRecord = bumpInputEpoch(epoch) // first recording
    bumpInputEpoch(epoch) // submit
    expect(isFreshTranscript(epoch, firstRecord)).toBe(false)

    const secondRecord = bumpInputEpoch(epoch) // new recording starts
    expect(isFreshTranscript(epoch, secondRecord)).toBe(true)
  })

  it('drops multiple late partials that arrive after a single submit', () => {
    const epoch = createInputEpoch()
    const recordedAt = bumpInputEpoch(epoch) // recording starts
    bumpInputEpoch(epoch) // submit
    // Several late partials arrive
    expect(isFreshTranscript(epoch, recordedAt)).toBe(false)
    expect(isFreshTranscript(epoch, recordedAt)).toBe(false)
    expect(isFreshTranscript(epoch, recordedAt)).toBe(false)
  })
})
