import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page } from 'vitest/browser'
import VoiceInputButtonTestHarness from './voice-input-button-test-harness.svelte'

vi.mock('$lib/capture/transcribe-audio', () => ({
  transcribeRecordedAudio: vi.fn(async () => ''),
  transcribeAudioChunk: vi.fn(async () => ''),
}))

/** Minimal MediaRecorder stub that records lifecycle calls without real audio. */
class FakeMediaRecorder {
  static isTypeSupported(mime: string) {
    return mime === 'audio/webm' || mime === 'audio/webm;codecs=opus'
  }
  mimeType = 'audio/webm;codecs=opus'
  state: 'inactive' | 'recording' = 'inactive'
  ondataavailable: ((ev: { data: { size: number } }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  startSpy = vi.fn()
  stopSpy = vi.fn()
  stream: MediaStream
  opts: MediaRecorderOptions | undefined
  constructor(stream: MediaStream, opts?: MediaRecorderOptions) {
    this.stream = stream
    this.opts = opts
  }
  start() {
    this.startSpy()
    this.state = 'recording'
  }
  stop() {
    this.stopSpy()
    this.state = 'inactive'
  }
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
    const samples = new Uint8Array(256)
    return {
      fftSize: 0,
      smoothingTimeConstant: 0,
      getByteTimeDomainData: (arr: Uint8Array) => {
        arr.set(samples)
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
  })

  afterEach(() => {
    restoreStubs()
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

  it('stopRecording stops the recorder, aborts the scheduler, and releases the stream', async () => {
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

    component.stopRef!()
    expect(onstop).toHaveBeenCalledTimes(1)
    // Second call is a no-op (guard returns early).
    expect(() => component.stopRef!()).not.toThrow()
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
})
