import { describe, expect, it } from 'vitest'
import { sttFormatFromMime, STT_SEGMENT_MAX_AUDIO_BYTES, STT_SEGMENT_MAX_SECONDS } from './stt-audio'

describe('stt-audio', () => {
  it('maps common mime types', () => {
    expect(sttFormatFromMime('audio/webm')).toBe('webm')
    expect(sttFormatFromMime('audio/webm;codecs=opus')).toBe('webm')
    expect(sttFormatFromMime('audio/wav')).toBe('wav')
  })

  it('returns null for unknown mime', () => {
    expect(sttFormatFromMime('application/octet-stream')).toBeNull()
  })

  it('caps one segment upload at 10 s of 48 kHz 16-bit stereo PCM (largest recorder format)', () => {
    expect(STT_SEGMENT_MAX_SECONDS).toBe(10)
    expect(STT_SEGMENT_MAX_AUDIO_BYTES).toBeGreaterThanOrEqual(48_000 * 2 * 2 * 10 + 44)
    expect(STT_SEGMENT_MAX_AUDIO_BYTES).toBeLessThan(10 * 1024 * 1024)
  })
})
