import { describe, expect, it, vi } from 'vitest'
import {
  createSegmentTranscriber,
  createSilenceCutter,
  MIN_SPEECH_MS,
  SEGMENT_FAILED_MESSAGE,
  SEGMENT_MAX_MS,
  SEGMENT_MIN_MS,
  SEGMENT_PAUSE_MS,
  SILENCE_LEVEL,
} from './segmented-stt'
import { TranscribeRequestError } from './transcribe-audio'

const LOUD = 0.5
const QUIET = SILENCE_LEVEL / 2

function blob(byte = 1) {
  return new Blob([new Uint8Array([byte])], { type: 'audio/webm' })
}

describe('segment bounds (D2)', () => {
  it('uses 3 s minimum / 350 ms pause / 10 s maximum', () => {
    expect(SEGMENT_MIN_MS).toBe(3000)
    expect(SEGMENT_PAUSE_MS).toBe(350)
    expect(SEGMENT_MAX_MS).toBe(10_000)
  })
})

describe('createSilenceCutter', () => {
  it('does not cut on a pause before the 3 s minimum', () => {
    const cutter = createSilenceCutter(0)
    expect(cutter.feed(LOUD, 0)).toBe(false)
    for (let t = 100; t <= 2900; t += 50) expect(cutter.feed(QUIET, t)).toBe(false)
  })

  it('cuts once silence lasts >= 350 ms after the 3 s minimum', () => {
    const cutter = createSilenceCutter(0)
    for (let t = 0; t <= 3000; t += 50) expect(cutter.feed(LOUD, t)).toBe(false)
    expect(cutter.feed(QUIET, 3050)).toBe(false)
    expect(cutter.feed(QUIET, 3300)).toBe(false)
    expect(cutter.feed(QUIET, 3400)).toBe(true)
  })

  it('a loud frame resets the pause timer', () => {
    const cutter = createSilenceCutter(0)
    cutter.feed(QUIET, 3000)
    cutter.feed(QUIET, 3300)
    cutter.feed(LOUD, 3320)
    expect(cutter.feed(QUIET, 3400)).toBe(false)
    expect(cutter.feed(QUIET, 3700)).toBe(false)
    expect(cutter.feed(QUIET, 3750)).toBe(true)
  })

  it('AC-6: forces a cut at 10 s when no pause comes (12 s of speech)', () => {
    const cutter = createSilenceCutter(0)
    let cutAt: number | null = null
    for (let t = 0; t <= 12_000; t += 50) {
      if (cutter.feed(LOUD, t)) {
        cutAt = t
        break
      }
    }
    expect(cutAt).toBe(10_000)
  })

  it('restart measures the next segment from the new start time', () => {
    const cutter = createSilenceCutter(0)
    expect(cutter.feed(LOUD, 10_000)).toBe(true)
    cutter.restart(10_000)
    expect(cutter.feed(QUIET, 11_000)).toBe(false)
    expect(cutter.feed(LOUD, 19_950)).toBe(false)
    expect(cutter.feed(LOUD, 20_000)).toBe(true)
  })
})

describe('createSilenceCutter speech tracking', () => {
  it('a segment of only quiet frames heard no speech', () => {
    const cutter = createSilenceCutter(0)
    for (let t = 0; t <= 3400; t += 50) cutter.feed(QUIET, t)
    expect(cutter.heardSpeech()).toBe(false)
  })

  it('a breath or click in a pause (a few loud frames) is still silence', () => {
    const cutter = createSilenceCutter(0)
    for (let t = 50; t <= 3400; t += 50) cutter.feed(t === 1000 || t === 1050 ? LOUD : QUIET, t)
    expect(cutter.heardSpeech()).toBe(false)
  })

  it(`a spoken stretch of at least ${MIN_SPEECH_MS}ms marks the segment as speech`, () => {
    const cutter = createSilenceCutter(0)
    for (let t = 50; t <= 3400; t += 50) {
      cutter.feed(t > 1000 && t <= 1000 + MIN_SPEECH_MS ? LOUD : QUIET, t)
    }
    expect(cutter.heardSpeech()).toBe(true)
  })

  it('restart clears speech for the next segment', () => {
    const cutter = createSilenceCutter(0)
    for (let t = 50; t <= 1000; t += 50) cutter.feed(LOUD, t)
    expect(cutter.heardSpeech()).toBe(true)
    cutter.restart(3500)
    cutter.feed(QUIET, 3550)
    expect(cutter.heardSpeech()).toBe(false)
  })
})

describe('createSegmentTranscriber', () => {
  it('AC-3: assembles out-of-order responses by index for partial and final', async () => {
    const resolvers: Array<(v: string) => void> = []
    const transcribe = vi.fn(() => new Promise<string>((resolve) => resolvers.push(resolve)))
    const onPartial = vi.fn()
    const t = createSegmentTranscriber({ transcribe, onPartial, onFatal: vi.fn() })
    t.submit(0, blob(0))
    t.submit(1, blob(1))
    t.submit(2, blob(2))
    await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(3))
    expect(transcribe.mock.calls.map((c) => c[1])).toEqual([0, 1, 2])

    resolvers[2]!('c')
    resolvers[1]!('b')
    await Promise.resolve()
    // segment 0 still pending: nothing after a gap is shown yet
    expect(onPartial).not.toHaveBeenCalled()
    resolvers[0]!('a')
    await expect(t.finish()).resolves.toBe('a b c')
    expect(onPartial).toHaveBeenLastCalledWith('a b c')
  })

  it('AC-2: partial grows by appending; earlier text is never rewritten', async () => {
    const transcribe = vi.fn(async (_b: Blob, i: number) => ['one', 'two', 'three'][i]!)
    const onPartial = vi.fn()
    const t = createSegmentTranscriber({ transcribe, onPartial, onFatal: vi.fn() })
    t.submit(0, blob())
    await vi.waitFor(() => expect(onPartial).toHaveBeenLastCalledWith('one'))
    t.submit(1, blob())
    await vi.waitFor(() => expect(onPartial).toHaveBeenLastCalledWith('one two'))
    t.submit(2, blob())
    await vi.waitFor(() => expect(onPartial).toHaveBeenLastCalledWith('one two three'))
    const partials = onPartial.mock.calls.map((c) => c[0] as string)
    for (let i = 1; i < partials.length; i++) {
      expect(partials[i]!.startsWith(partials[i - 1]!)).toBe(true)
    }
  })

  it('treats an empty (silence) segment as valid and contributes nothing', async () => {
    const transcribe = vi.fn(async (_b: Blob, i: number) => ['hello', '  ', 'world'][i]!)
    const onFatal = vi.fn()
    const t = createSegmentTranscriber({ transcribe, onPartial: vi.fn(), onFatal })
    t.submit(0, blob())
    t.submit(1, blob())
    t.submit(2, blob())
    await expect(t.finish()).resolves.toBe('hello world')
    expect(onFatal).not.toHaveBeenCalled()
  })

  it('AC-4: a failed segment is fatal on the first failure — retries live on the server only', async () => {
    const transcribe = vi.fn(async (_b: Blob, i: number) => {
      if (i === 1) throw new TranscribeRequestError(500, 'upstream 502')
      return 'fine'
    })
    const onFatal = vi.fn()
    const t = createSegmentTranscriber({ transcribe, onPartial: vi.fn(), onFatal })
    t.submit(0, blob())
    t.submit(1, blob())
    await expect(t.finish()).rejects.toThrow(SEGMENT_FAILED_MESSAGE)
    expect(transcribe.mock.calls.filter((c) => c[1] === 1)).toHaveLength(1)
    expect(onFatal).toHaveBeenCalledTimes(1)
    expect(onFatal).toHaveBeenCalledWith(SEGMENT_FAILED_MESSAGE)
  })

  it('AC-5: 402 is never retried and surfaces the billing message', async () => {
    const transcribe = vi.fn(async () => {
      throw new TranscribeRequestError(402, 'Insufficient credits — top up to continue')
    })
    const onFatal = vi.fn()
    const t = createSegmentTranscriber({ transcribe, onPartial: vi.fn(), onFatal })
    t.submit(0, blob())
    await expect(t.finish()).rejects.toThrow('Insufficient credits — top up to continue')
    expect(transcribe).toHaveBeenCalledTimes(1)
    expect(onFatal).toHaveBeenCalledWith('Insufficient credits — top up to continue')
  })

  it('after a fatal error, later submits are ignored and in-flight requests are aborted', async () => {
    const signals: AbortSignal[] = []
    const transcribe = vi.fn((_b: Blob, i: number, signal: AbortSignal) => {
      signals.push(signal)
      if (i === 0) return Promise.reject(new TranscribeRequestError(402, 'no credits'))
      return new Promise<string>(() => undefined)
    })
    const onFatal = vi.fn()
    const t = createSegmentTranscriber({ transcribe, onPartial: vi.fn(), onFatal })
    t.submit(1, blob())
    t.submit(0, blob())
    await vi.waitFor(() => expect(onFatal).toHaveBeenCalledTimes(1))
    expect(signals[0]!.aborted).toBe(true)
    t.submit(2, blob())
    expect(transcribe).toHaveBeenCalledTimes(2)
  })

  it('stop-while-in-flight: finish waits for pending segments', async () => {
    let release: ((v: string) => void) | undefined
    const transcribe = vi.fn(
      (_b: Blob, i: number) =>
        new Promise<string>((resolve) => {
          if (i === 0) release = resolve
          else resolve('tail')
        }),
    )
    const t = createSegmentTranscriber({ transcribe, onPartial: vi.fn(), onFatal: vi.fn() })
    t.submit(0, blob())
    t.submit(1, blob())
    let done = false
    const final = t.finish().then((v) => {
      done = true
      return v
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(done).toBe(false)
    release!('head')
    await expect(final).resolves.toBe('head tail')
  })

  it('abort cancels in-flight requests without fatal or partial callbacks', async () => {
    const signals: AbortSignal[] = []
    const transcribe = vi.fn((_b: Blob, _i: number, signal: AbortSignal) => {
      signals.push(signal)
      return new Promise<string>((_r, reject) =>
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))),
      )
    })
    const onPartial = vi.fn()
    const onFatal = vi.fn()
    const t = createSegmentTranscriber({ transcribe, onPartial, onFatal })
    t.submit(0, blob())
    t.abort()
    await Promise.resolve()
    expect(signals[0]!.aborted).toBe(true)
    expect(transcribe).toHaveBeenCalledTimes(1)
    expect(onPartial).not.toHaveBeenCalled()
    expect(onFatal).not.toHaveBeenCalled()
  })

  it('a skipped (silent) segment is never transcribed and keeps the order intact', async () => {
    const transcribe = vi.fn(async (_b: Blob, index: number) => `s${index}`)
    const onPartial = vi.fn()
    const t = createSegmentTranscriber({ transcribe, onPartial, onFatal: vi.fn() })
    t.submit(0, blob())
    t.skip(1)
    t.submit(2, blob())
    await expect(t.finish()).resolves.toBe('s0 s2')
    expect(transcribe.mock.calls.map((c) => c[1])).toEqual([0, 2])
  })

  it('a recording of only skipped segments finishes empty (no speech)', async () => {
    const transcribe = vi.fn(async () => 'hallucinated')
    const t = createSegmentTranscriber({ transcribe, onPartial: vi.fn(), onFatal: vi.fn() })
    t.skip(0)
    t.skip(1)
    await expect(t.finish()).resolves.toBe('')
    expect(transcribe).not.toHaveBeenCalled()
  })

  it('rejects a duplicate segment index (programming error, not silently merged)', () => {
    const t = createSegmentTranscriber({
      transcribe: vi.fn(async () => 'x'),
      onPartial: vi.fn(),
      onFatal: vi.fn(),
    })
    t.submit(0, blob())
    expect(() => t.submit(0, blob())).toThrow(/segment 0/)
  })
})
