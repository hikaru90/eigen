import { describe, expect, it } from 'vitest'
import {
  CLIP_DECODE_SAMPLE_RATE,
  clipHasSpeechLevelSound,
  FRAME_MS,
  MIN_VOICED_MS,
  VOICED_RMS_THRESHOLD,
  type DecodedClip,
} from './clip-speech'

const RATE = CLIP_DECODE_SAMPLE_RATE

function samplesFor(ms: number): number {
  return Math.round((ms / 1000) * RATE)
}

/** A steady tone with the given RMS, for `ms`, as samples. */
function tone(ms: number, rms: number): Float32Array {
  const out = new Float32Array(samplesFor(ms))
  const peak = rms * Math.SQRT2
  for (let i = 0; i < out.length; i++) out[i] = peak * Math.sin((2 * Math.PI * 220 * i) / RATE)
  return out
}

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

function clip(...channels: Float32Array[]): DecodedClip {
  return { channels, sampleRate: RATE }
}

const silence = (ms: number) => new Float32Array(samplesFor(ms))

describe('clipHasSpeechLevelSound (Layer 1: audio check on the finished clip)', () => {
  it('constants are conservative: a low threshold and a short minimum, named and exported', () => {
    expect(VOICED_RMS_THRESHOLD).toBeLessThanOrEqual(0.01)
    expect(MIN_VOICED_MS).toBeLessThanOrEqual(200)
    expect(FRAME_MS).toBe(20)
  })

  it('digital silence is not speech', () => {
    expect(clipHasSpeechLevelSound(clip(silence(3000)))).toBe(false)
  })

  it('a room-tone noise floor below the threshold is not speech', () => {
    expect(clipHasSpeechLevelSound(clip(tone(5000, VOICED_RMS_THRESHOLD / 4)))).toBe(false)
  })

  it('an empty clip is not speech', () => {
    expect(clipHasSpeechLevelSound(clip(new Float32Array(0)))).toBe(false)
    expect(clipHasSpeechLevelSound(clip())).toBe(false)
  })

  it('a click or bump (one short loud burst) is not speech, however loud', () => {
    const click = tone(FRAME_MS * 2, 0.9)
    expect(clipHasSpeechLevelSound(clip(concat(silence(1000), click, silence(1000))))).toBe(false)
  })

  it('several separate clicks that never add up to the minimum voiced duration are not speech', () => {
    const click = tone(FRAME_MS, 0.9)
    const gap = silence(500)
    expect(clipHasSpeechLevelSound(clip(concat(click, gap, click, gap, click, gap)))).toBe(false)
  })

  it('speech-level sound for at least the minimum voiced duration is speech', () => {
    const word = tone(MIN_VOICED_MS + FRAME_MS * 2, 0.05)
    expect(clipHasSpeechLevelSound(clip(concat(silence(500), word, silence(500))))).toBe(true)
  })

  it('voiced time adds up across pauses (a short word, a gap, another short word)', () => {
    const half = tone(MIN_VOICED_MS / 2 + FRAME_MS, 0.05)
    expect(clipHasSpeechLevelSound(clip(concat(half, silence(600), half)))).toBe(true)
  })

  it('soft speech just above the threshold still passes', () => {
    expect(clipHasSpeechLevelSound(clip(tone(1000, VOICED_RMS_THRESHOLD * 3)))).toBe(true)
  })

  it('judges all channels (speech in one channel only still counts)', () => {
    expect(clipHasSpeechLevelSound(clip(silence(1000), tone(1000, 0.1)))).toBe(true)
  })

  it('reads only the decoded samples it is given, never a live meter', () => {
    // the same samples give the same answer whatever an AudioContext reported while recording
    const samples = tone(1000, 0.1)
    expect(clipHasSpeechLevelSound(clip(samples))).toBe(true)
    expect(clipHasSpeechLevelSound(clip(samples))).toBe(true)
  })
})
