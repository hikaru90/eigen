import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WHISPER_SWAP_MS, resetWhisper, showWhisper, whisper } from './whisper.svelte'

describe('whisper store (ei app.js:159-173)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetWhisper()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts empty and not swapping', () => {
    expect(whisper.text).toBe('')
    expect(whisper.swapping).toBe(false)
  })

  it('walks the steps with timed swaps, blurring out before each text lands', () => {
    showWhisper([
      { text: 'settling…', durationMs: 800 },
      { text: 'knitting it in…', durationMs: 1100 },
    ])

    // at t=0 the first swap starts: the old text blurs out…
    vi.advanceTimersByTime(0)
    expect(whisper.swapping).toBe(true)
    expect(whisper.text).toBe('')
    // …and after SWAP_MS the step's words are in
    vi.advanceTimersByTime(WHISPER_SWAP_MS)
    expect(whisper.text).toBe('settling…')
    expect(whisper.swapping).toBe(false)

    // t=800: the second step's swap starts while the first words are still shown
    vi.advanceTimersByTime(800 - WHISPER_SWAP_MS)
    expect(whisper.text).toBe('settling…')
    expect(whisper.swapping).toBe(true)
    vi.advanceTimersByTime(WHISPER_SWAP_MS)
    expect(whisper.text).toBe('knitting it in…')
    expect(whisper.swapping).toBe(false)
  })

  it('clears itself at the end of the walk', () => {
    showWhisper([{ text: 'kept', durationMs: 500 }])
    vi.advanceTimersByTime(WHISPER_SWAP_MS)
    expect(whisper.text).toBe('kept')
    // t=500: the final swap to '' starts (blur out)…
    vi.advanceTimersByTime(500 - WHISPER_SWAP_MS)
    expect(whisper.text).toBe('kept')
    expect(whisper.swapping).toBe(true)
    // …t=700: cleared
    vi.advanceTimersByTime(WHISPER_SWAP_MS)
    expect(whisper.text).toBe('')
    expect(whisper.swapping).toBe(false)
  })

  it('cancels a prior show', () => {
    showWhisper([
      { text: 'first', durationMs: 300 },
      { text: 'second', durationMs: 300 },
    ])
    vi.advanceTimersByTime(100)
    showWhisper([{ text: 'latest', durationMs: 1000 }])
    vi.advanceTimersByTime(WHISPER_SWAP_MS)
    expect(whisper.text).toBe('latest')
    // the old walk's later steps must never land
    vi.advanceTimersByTime(2000)
    expect(whisper.text).toBe('')
  })

  it('reset() clears the text and cancels pending swaps', () => {
    showWhisper([{ text: 'knitting it in…', durationMs: 2000 }])
    vi.advanceTimersByTime(WHISPER_SWAP_MS)
    expect(whisper.text).toBe('knitting it in…')
    resetWhisper()
    expect(whisper.text).toBe('')
    expect(whisper.swapping).toBe(false)
    vi.advanceTimersByTime(3000)
    expect(whisper.text).toBe('')
    expect(whisper.swapping).toBe(false)
  })

  it('an empty step list just clears', () => {
    showWhisper([{ text: 'kept', durationMs: 100 }])
    vi.advanceTimersByTime(WHISPER_SWAP_MS)
    expect(whisper.text).toBe('kept')
    showWhisper([])
    vi.advanceTimersByTime(WHISPER_SWAP_MS)
    expect(whisper.text).toBe('')
  })

  it('clamps negative durations so the next step is not delayed', () => {
    showWhisper([
      { text: 'a', durationMs: -50 },
      { text: 'b', durationMs: 100 },
    ])
    vi.advanceTimersByTime(WHISPER_SWAP_MS)
    expect(whisper.text).toBe('b')
    vi.advanceTimersByTime(500)
    expect(whisper.text).toBe('')
  })
})
