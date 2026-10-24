import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page } from 'vitest/browser'
import { SEGMENT_FAILED_MESSAGE } from '$lib/capture/segmented-stt'
import { transcribeAudioChunk, TranscribeRequestError } from '$lib/capture/transcribe-audio'
import VoiceInputButtonTestHarness from './voice-input-button-test-harness.svelte'

vi.mock('$lib/capture/transcribe-audio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/capture/transcribe-audio')>()),
  transcribeAudioChunk: vi.fn(async () => ''),
}))

const chunkMock = vi.mocked(transcribeAudioChunk)

/** EBML magic: every standalone WebM file starts with these 4 bytes. */
const EBML = [0x1a, 0x45, 0xdf, 0xa3]

/**
 * MediaRecorder stub: each instance is one recording. `stop()` fires
 * dataavailable with a complete WebM-like file (EBML header + instance id) and
 * then `onstop`, asynchronously like the real API.
 */
class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = []
  static isTypeSupported(mime: string) {
    return mime === 'audio/webm' || mime === 'audio/webm;codecs=opus'
  }
  mimeType = 'audio/webm;codecs=opus'
  state: 'inactive' | 'recording' = 'inactive'
  ondataavailable: ((ev: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  startSpy = vi.fn()
  stopSpy = vi.fn()
  stream: MediaStream
  opts: MediaRecorderOptions | undefined
  readonly id: number
  constructor(stream: MediaStream, opts?: MediaRecorderOptions) {
    this.stream = stream
    this.opts = opts
    this.id = FakeMediaRecorder.instances.length
    FakeMediaRecorder.instances.push(this)
  }
  start(timeslice?: number) {
    this.startSpy(timeslice)
    this.state = 'recording'
  }
  stop() {
    this.stopSpy()
    if (this.state === 'inactive') return
    this.state = 'inactive'
    setTimeout(() => {
      this.ondataavailable?.({
        data: new Blob([new Uint8Array([...EBML, this.id])], { type: this.mimeType }),
      })
      this.onstop?.()
    }, 0)
  }
}

/** Mic signal the fake analyser reports: silence (all 128) or a loud square wave. */
let micLoud = false
/** Clock read by the segment cutter (`performance.now`). */
let nowMs = 0

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Hold the mic signal at `loud` while the clock moves to `toMs`. */
async function speakUntil(toMs: number, loud: boolean) {
  micLoud = loud
  await sleep(120)
  nowMs = toMs
  await sleep(120)
}

function fakeTrack() {
  return { stop: vi.fn(), kind: 'audio' }
}

function fakeStream(): MediaStream {
  const tracks = [fakeTrack(), fakeTrack()]
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks,
    getVideoTracks: () => [],
    active: true,
    id: 'stream-1',
  } as unknown as MediaStream
}

/** AudioContext stub so startLevelMeter runs without touching real audio. */
class FakeAudioContext {
  readonly state = 'running'
  createMediaStreamSource() {
    return { connect: vi.fn() } as unknown as AudioNode
  }
  createAnalyser() {
    const samples = new Uint8Array(256).fill(128)
    return {
      fftSize: 0,
      smoothingTimeConstant: 0,
      getByteTimeDomainData: (arr: Uint8Array) => {
        if (micLoud) {
          for (let i = 0; i < arr.length; i++) arr[i] = i % 2 ? 255 : 0
        } else {
          arr.set(samples)
        }
      },
      connect: vi.fn(),
    } as unknown as AnalyserNode
  }
  resume() {}
  close() {}
}

const originalMediaRecorder = (globalThis as { MediaRecorder?: unknown }).MediaRecorder
const originalAudioContext = (globalThis as { AudioContext?: unknown }).AudioContext
const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')

function installStubs(): MediaStream {
  Object.defineProperty(globalThis, 'MediaRecorder', {
    configurable: true,
    writable: true,
    value: FakeMediaRecorder,
  })
  Object.defineProperty(globalThis, 'AudioContext', {
    configurable: true,
    writable: true,
    value: FakeAudioContext,
  })
  const stream = fakeStream()
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => stream),
      enumerateDevices: vi.fn(async () => []),
    },
  })
  return stream
}

function restoreStubs() {
  if (originalMediaRecorder !== undefined) {
    Object.defineProperty(globalThis, 'MediaRecorder', {
      configurable: true,
      writable: true,
      value: originalMediaRecorder,
    })
  }
  if (originalAudioContext !== undefined) {
    Object.defineProperty(globalThis, 'AudioContext', {
      configurable: true,
      writable: true,
      value: originalAudioContext,
    })
  }
  if (originalMediaDevices) {
    Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices)
  }
}

describe('voice-input-button.svelte', () => {
  let stream: MediaStream

  beforeEach(() => {
    stream = installStubs()
    FakeMediaRecorder.instances = []
    micLoud = false
    nowMs = 0
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs)
    chunkMock.mockReset()
    chunkMock.mockImplementation(async (_blob, opts) => `seg${opts?.segment}`)
  })

  afterEach(() => {
    vi.mocked(performance.now).mockRestore()
    restoreStubs()
  })

  async function startRecording(props: Record<string, unknown> = {}) {
    const handlers = {
      ontranscript: vi.fn(),
      onpartialtranscript: vi.fn(),
      onerror: vi.fn(),
      onstop: vi.fn(),
      ...props,
    }
    const rendered = render(VoiceInputButtonTestHarness, handlers)
    await page.getByRole('button', { name: 'Start voice input' }).click()
    await expect
      .element(page.getByRole('button', { name: 'Stop recording and transcribe' }))
      .toBeInTheDocument()
    return Object.assign(handlers, { component: rendered.component })
  }

  it('shows an explicit stop glyph while recording — the bars alone do not say what to press', async () => {
    const idle = render(VoiceInputButtonTestHarness, {
      ontranscript: vi.fn(),
      onpartialtranscript: vi.fn(),
      onerror: vi.fn(),
      onstop: vi.fn(),
    })
    await expect
      .element(page.getByTestId('voice-stop-glyph'))
      .not.toBeInTheDocument()
    idle.unmount()

    await startRecording()
    await expect.element(page.getByTestId('voice-stop-glyph')).toBeInTheDocument()
  })

  it('SEG-1: cuts at a pause after 3 s by restarting MediaRecorder on the same stream', async () => {
    await startRecording()
    expect(FakeMediaRecorder.instances).toHaveLength(1)
    // no timeslice: each recorder yields one whole file
    expect(FakeMediaRecorder.instances[0]!.startSpy).toHaveBeenCalledWith(undefined)

    await speakUntil(2000, true)
    await speakUntil(2500, false) // pause before the 3 s minimum: no cut
    expect(FakeMediaRecorder.instances).toHaveLength(1)

    await speakUntil(3200, true)
    await speakUntil(3300, false)
    await speakUntil(3700, false) // 400 ms of silence past 3 s → cut
    await vi.waitFor(() => expect(FakeMediaRecorder.instances).toHaveLength(2))
    const [first, second] = FakeMediaRecorder.instances
    expect(first!.stopSpy).toHaveBeenCalled()
    expect(second!.stream).toBe(first!.stream)
    expect(second!.state).toBe('recording')
    await vi.waitFor(() => expect(chunkMock).toHaveBeenCalledTimes(1))
    expect(chunkMock.mock.calls[0]![1]).toMatchObject({ segment: 0 })
  })

  it('AC-6: forces a segment at 10 s of continuous speech', async () => {
    await startRecording()
    await speakUntil(9900, true)
    expect(FakeMediaRecorder.instances).toHaveLength(1)
    await speakUntil(10_000, true)
    await vi.waitFor(() => expect(FakeMediaRecorder.instances).toHaveLength(2))
  })

  it('AC-7: every uploaded segment is a standalone file starting with the EBML header', async () => {
    const { ontranscript } = await startRecording()
    await speakUntil(10_000, true)
    await vi.waitFor(() => expect(FakeMediaRecorder.instances).toHaveLength(2))
    await page.getByRole('button', { name: 'Stop recording and transcribe' }).click()
    await vi.waitFor(() => expect(ontranscript).toHaveBeenCalled())
    expect(chunkMock).toHaveBeenCalledTimes(2)
    for (const [blob] of chunkMock.mock.calls) {
      const bytes = new Uint8Array(await blob.arrayBuffer())
      expect([...bytes.slice(0, 4)]).toEqual(EBML)
      expect(bytes.length).toBe(5) // one recorder's data only, never concatenated
    }
  })

  it('SEG-3/4: partials join segments; stop emits the joined final with no full upload', async () => {
    const { onpartialtranscript, ontranscript } = await startRecording()
    await speakUntil(10_000, true)
    await vi.waitFor(() => expect(onpartialtranscript).toHaveBeenLastCalledWith('seg0'))
    expect(ontranscript).not.toHaveBeenCalled()

    await page.getByRole('button', { name: 'Stop recording and transcribe' }).click()
    await vi.waitFor(() => expect(ontranscript).toHaveBeenCalledWith('seg0 seg1'))
    expect(ontranscript).toHaveBeenCalledTimes(1)
    // exactly one request per segment — no cumulative or final full-recording pass
    expect(chunkMock).toHaveBeenCalledTimes(2)
    expect(chunkMock.mock.calls.map((c) => c[1]?.segment)).toEqual([0, 1])
  })

  it('stop while a segment is in flight waits for it before emitting the final transcript', async () => {
    let release: ((v: string) => void) | undefined
    chunkMock.mockImplementation((_blob, opts) =>
      opts?.segment === 0
        ? new Promise<string>((resolve) => (release = resolve))
        : Promise.resolve('tail'),
    )
    const { ontranscript } = await startRecording()
    await speakUntil(10_000, true)
    await vi.waitFor(() => expect(chunkMock).toHaveBeenCalledTimes(1))
    await page.getByRole('button', { name: 'Stop recording and transcribe' }).click()
    await expect.element(page.getByRole('button', { name: 'Transcribing' })).toBeInTheDocument()
    await vi.waitFor(() => expect(chunkMock).toHaveBeenCalledTimes(2))
    expect(ontranscript).not.toHaveBeenCalled()
    release!('head')
    await vi.waitFor(() => expect(ontranscript).toHaveBeenCalledWith('head tail'))
    await expect
      .element(page.getByRole('button', { name: 'Start voice input' }))
      .toBeInTheDocument()
  })

  it('AC-4: a failed segment (server already retried) stops recording, shows the error, and clears the partial', async () => {
    chunkMock.mockImplementation(async (_blob, opts) => {
      if (opts?.segment === 1) throw new TranscribeRequestError(500, 'upstream 502')
      return 'kept'
    })
    const { onerror, onpartialtranscript, ontranscript, onstop } = await startRecording()
    await speakUntil(10_000, true)
    await vi.waitFor(() => expect(onpartialtranscript).toHaveBeenLastCalledWith('kept'))
    await speakUntil(20_000, true)
    await vi.waitFor(() => expect(onerror).toHaveBeenCalledWith(SEGMENT_FAILED_MESSAGE))
    expect(chunkMock.mock.calls.filter((c) => c[1]?.segment === 1)).toHaveLength(1)
    // the draft is restored: nothing partial can be captured as a thought
    expect(onpartialtranscript).toHaveBeenLastCalledWith('')
    expect(ontranscript).not.toHaveBeenCalled()
    expect(onstop).toHaveBeenCalled()
    await expect
      .element(page.getByRole('button', { name: 'Start voice input' }))
      .toBeInTheDocument()
    for (const track of stream.getTracks()) expect(track.stop).toHaveBeenCalled()
    expect(FakeMediaRecorder.instances.every((r) => r.state === 'inactive')).toBe(true)
  })

  it('AC-5: a 402 is not retried and shows the billing message', async () => {
    chunkMock.mockImplementation(async () => {
      throw new TranscribeRequestError(402, 'Insufficient credits')
    })
    const { onerror, ontranscript } = await startRecording()
    await speakUntil(10_000, true)
    await vi.waitFor(() => expect(onerror).toHaveBeenCalledWith('Insufficient credits'))
    expect(chunkMock).toHaveBeenCalledTimes(1)
    expect(ontranscript).not.toHaveBeenCalled()
    await expect
      .element(page.getByRole('button', { name: 'Start voice input' }))
      .toBeInTheDocument()
  })

  it('a recording with only silence reports an explicit error instead of an empty transcript', async () => {
    chunkMock.mockImplementation(async () => '')
    const { onerror, ontranscript } = await startRecording()
    await page.getByRole('button', { name: 'Stop recording and transcribe' }).click()
    await vi.waitFor(() => expect(onerror).toHaveBeenCalledWith('No speech detected'))
    expect(ontranscript).not.toHaveBeenCalled()
  })

  it('keeps stopRef set until the final transcript is out (the writer keeps the mic mounted)', async () => {
    let stopRefAtTranscript: unknown = 'unset'
    const handlers = await startRecording({
      ontranscript: vi.fn(() => {
        stopRefAtTranscript = handlers.component.stopRef
      }),
    })
    await speakUntil(10_000, true)
    await vi.waitFor(() => expect(FakeMediaRecorder.instances).toHaveLength(2))
    await page.getByRole('button', { name: 'Stop recording and transcribe' }).click()
    await vi.waitFor(() => expect(handlers.ontranscript).toHaveBeenCalled())
    // still set while the final transcript is emitted, cleared right after
    expect(typeof stopRefAtTranscript).toBe('function')
    await vi.waitFor(() => expect(handlers.component.stopRef).toBeUndefined())
    expect(chunkMock).toHaveBeenCalledTimes(2)
  })

  it('exposes stopRef as a function once recording is active', async () => {
    const onstart = vi.fn()
    const { component } = render(VoiceInputButtonTestHarness, {
      onstart,
      ontranscript: vi.fn(),
      onpartialtranscript: vi.fn(),
    })

    expect(component.stopRef).toBeUndefined()
    await page.getByRole('button', { name: 'Start voice input' }).click()
    await expect
      .element(page.getByRole('button', { name: 'Stop recording and transcribe' }))
      .toBeInTheDocument()
    expect(onstart).toHaveBeenCalledTimes(1)
    expect(typeof component.stopRef).toBe('function')
  })

  it('stopRecording (discard) stops the recorder, uploads nothing, and releases the stream', async () => {
    const onstop = vi.fn()
    const { component } = render(VoiceInputButtonTestHarness, {
      onstop,
      ontranscript: vi.fn(),
      onpartialtranscript: vi.fn(),
    })

    await page.getByRole('button', { name: 'Start voice input' }).click()
    await expect
      .element(page.getByRole('button', { name: 'Stop recording and transcribe' }))
      .toBeInTheDocument()
    expect(typeof component.stopRef).toBe('function')

    const tracks = stream.getTracks()
    component.stopRef!()
    // Stream tracks are released.
    for (const track of tracks) {
      expect(track.stop).toHaveBeenCalledTimes(1)
    }
    expect(onstop).toHaveBeenCalledTimes(1)
    // After stop, the button returns to the idle mic state and stopRef is cleared.
    await expect
      .element(page.getByRole('button', { name: 'Start voice input' }))
      .toBeInTheDocument()
    expect(component.stopRef).toBeUndefined()
    await sleep(50)
    expect(chunkMock).not.toHaveBeenCalled()
  })

  it('stopRecording is idempotent — calling twice does not double-stop or throw', async () => {
    const onstop = vi.fn()
    const { component } = render(VoiceInputButtonTestHarness, {
      onstop,
      ontranscript: vi.fn(),
      onpartialtranscript: vi.fn(),
    })

    await page.getByRole('button', { name: 'Start voice input' }).click()
    await expect
      .element(page.getByRole('button', { name: 'Stop recording and transcribe' }))
      .toBeInTheDocument()
    const tracks = stream.getTracks()

    // Hold the stop function: the parent may still call a stale reference after stopRef clears.
    const stop = component.stopRef!
    stop()
    expect(onstop).toHaveBeenCalledTimes(1)
    expect(component.stopRef).toBeUndefined()
    // Second call is a no-op (guard returns early).
    expect(() => stop()).not.toThrow()
    expect(onstop).toHaveBeenCalledTimes(1)
    for (const track of tracks) {
      expect(track.stop).toHaveBeenCalledTimes(1)
    }
  })

  it('does not expose stopRef before recording starts', async () => {
    const { component } = render(VoiceInputButtonTestHarness, {
      ontranscript: vi.fn(),
    })
    expect(component.stopRef).toBeUndefined()
  })
  it('shows the live level meter inside the button only while recording', async () => {
    render(VoiceInputButtonTestHarness, { ontranscript: vi.fn() })
    await expect.element(page.getByTestId('voice-level-meter')).not.toBeInTheDocument()
    await page.getByRole('button', { name: 'Start voice input' }).click()
    const meter = page.getByTestId('voice-level-meter')
    await expect.element(meter).toBeInTheDocument()
    const children = (meter.element() as HTMLElement).children
    // the stop glyph first, then the five live bars
    expect(children.length).toBe(6)
    expect((children[0] as HTMLElement).dataset.testid).toBe('voice-stop-glyph')
    expect((children[1] as HTMLElement).style.getPropertyValue('--lvl')).toMatch(/^\d/)
    await expect.element(page.getByRole('meter', { name: 'Microphone level' })).toBeInTheDocument()
  })
})
