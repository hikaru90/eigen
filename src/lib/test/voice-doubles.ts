import { vi } from 'vitest'

/**
 * Test doubles for the voice-message recorder (`$lib/capture/voice-message`): a
 * MediaRecorder, an AudioContext/analyser and a MediaStream that need no hardware.
 * DOM-free, so the node unit spec injects them as `deps` and the browser component specs
 * install them as globals with {@link installVoiceDoubles}.
 */

/** The signal the fake analyser reports. Silence is all 128s (8-bit time-domain midpoint). */
export const micSignal = { loud: false }

export class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = []
  /** MIME types `isTypeSupported` answers true for. */
  static supported = new Set<string>(['audio/webm;codecs=opus'])

  static reset(): void {
    FakeMediaRecorder.instances = []
    FakeMediaRecorder.supported = new Set(['audio/webm;codecs=opus'])
    FakeMediaRecorder.tail = [0xee, 0xee]
  }

  static isTypeSupported(mime: string): boolean {
    return FakeMediaRecorder.supported.has(mime)
  }

  /** Bytes the recorder flushes when it is stopped (the last, partial timeslice). */
  static tail: number[] = [0xee, 0xee]

  readonly stream: MediaStream
  readonly options: MediaRecorderOptions | undefined
  mimeType: string
  state: 'inactive' | 'recording' = 'inactive'
  startCalls: Array<number | undefined> = []
  stopCalls = 0
  ondataavailable: ((ev: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(stream: MediaStream, options?: MediaRecorderOptions) {
    this.stream = stream
    this.options = options
    // with no requested type a real recorder picks its own default
    this.mimeType = options?.mimeType ?? 'audio/webm;codecs=opus'
    FakeMediaRecorder.instances.push(this)
  }

  start(timeslice?: number): void {
    this.startCalls.push(timeslice)
    this.state = 'recording'
  }

  /** Test: the browser hands over one timeslice of audio. */
  emitChunk(bytes: number[]): void {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)], { type: this.mimeType }) })
  }

  /** Like the real API: flush the rest as a last `dataavailable`, then `stop`, asynchronously. */
  stop(): void {
    this.stopCalls += 1
    if (this.state === 'inactive') return
    this.state = 'inactive'
    void Promise.resolve().then(() => {
      if (FakeMediaRecorder.tail.length > 0) this.emitChunk(FakeMediaRecorder.tail)
      this.onstop?.()
    })
  }

  /** Test: the browser ended the recording by itself (a call came in, the mic was unplugged). */
  interrupt(): void {
    this.state = 'inactive'
    this.onstop?.()
  }

  /** Test: the recorder reports an error. */
  fail(): void {
    this.onerror?.()
  }
}

export class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  static reset(): void {
    FakeAudioContext.instances = []
  }

  state: 'suspended' | 'running' = 'suspended'
  resume = vi.fn(() => {
    this.state = 'running'
    return Promise.resolve()
  })
  close = vi.fn(() => Promise.resolve())

  constructor() {
    FakeAudioContext.instances.push(this)
  }

  createMediaStreamSource(): { connect: ReturnType<typeof vi.fn> } {
    return { connect: vi.fn() }
  }

  createAnalyser() {
    return {
      fftSize: 0,
      smoothingTimeConstant: 0,
      getByteTimeDomainData(samples: Uint8Array) {
        if (micSignal.loud) {
          for (let i = 0; i < samples.length; i++) samples[i] = i % 2 ? 255 : 0
        } else {
          samples.fill(128)
        }
      },
    }
  }
}

export function fakeStream(): MediaStream & { tracks: Array<{ stop: ReturnType<typeof vi.fn> }> } {
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }]
  return {
    tracks,
    getTracks: () => tracks,
    getAudioTracks: () => tracks,
    getVideoTracks: () => [],
  } as unknown as MediaStream & { tracks: Array<{ stop: ReturnType<typeof vi.fn> }> }
}

/** Replaces the browser's recorder, audio and mic globals; `restore()` puts them back. */
export function installVoiceDoubles(): {
  stream: ReturnType<typeof fakeStream>
  getUserMedia: ReturnType<typeof vi.fn>
  restore: () => void
} {
  FakeMediaRecorder.reset()
  FakeAudioContext.reset()
  micSignal.loud = false
  const stream = fakeStream()
  const getUserMedia = vi.fn(async () => stream)

  const replaced: Array<[object, string, PropertyDescriptor | undefined]> = []
  function replace(target: object, key: string, descriptor: PropertyDescriptor): void {
    replaced.push([target, key, Object.getOwnPropertyDescriptor(target, key)])
    Object.defineProperty(target, key, { configurable: true, ...descriptor })
  }
  replace(globalThis, 'MediaRecorder', { writable: true, value: FakeMediaRecorder })
  replace(globalThis, 'AudioContext', { writable: true, value: FakeAudioContext })
  replace(navigator, 'mediaDevices', {
    value: { getUserMedia, enumerateDevices: vi.fn(async () => []) },
  })

  return {
    stream,
    getUserMedia,
    restore() {
      for (const [target, key, original] of replaced.reverse()) {
        if (original) Object.defineProperty(target, key, original)
        else Reflect.deleteProperty(target, key)
      }
    },
  }
}
