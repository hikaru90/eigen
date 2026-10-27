import { describe, expect, it } from 'vitest'
import { voiceFailureMessage } from './voice-failure-message'

describe('voiceFailureMessage', () => {
  it('words every failure plainly', () => {
    expect(voiceFailureMessage({ reason: 'permission', retryable: false })).toBe(
      'Microphone permission denied',
    )
    expect(voiceFailureMessage({ reason: 'microphone', retryable: false })).toBe(
      "Couldn't access the microphone",
    )
    expect(voiceFailureMessage({ reason: 'recorder', retryable: false })).toBe('Recording failed')
    expect(voiceFailureMessage({ reason: 'interrupted', retryable: true })).toBe(
      'The recording was interrupted',
    )
    expect(voiceFailureMessage({ reason: 'empty', retryable: true })).toBe('No speech detected')
  })

  it('shows the server message for a billing (402) or rejected (400) upload', () => {
    expect(
      voiceFailureMessage({
        reason: 'request',
        status: 402,
        detail: 'Insufficient credits',
        retryable: true,
      }),
    ).toBe('Insufficient credits')
    expect(
      voiceFailureMessage({
        reason: 'request',
        status: 400,
        detail: 'audio clip exceeds 8388608 bytes (max 5 minutes)',
        retryable: true,
      }),
    ).toBe('audio clip exceeds 8388608 bytes (max 5 minutes)')
  })

  it('does not pass provider noise through: any other failed request reads the same', () => {
    const generic = "Couldn't transcribe the recording"
    expect(
      voiceFailureMessage({
        reason: 'request',
        status: 502,
        detail: 'LLM STT HTTP 502: upstream gone',
        retryable: true,
      }),
    ).toBe(generic)
    // no status: the network itself failed
    expect(
      voiceFailureMessage({ reason: 'request', detail: 'Failed to fetch', retryable: true }),
    ).toBe(generic)
    expect(
      voiceFailureMessage({ reason: 'request', status: 401, detail: 'Unauthorized', retryable: true }),
    ).toBe(generic)
  })
})
