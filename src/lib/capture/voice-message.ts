/**
 * Voice messages (docs/planning/feature-voice-message-stt.md).
 *
 * One tap records one clip: a single MediaRecorder with a 1 s timeslice, the chunks held in
 * memory only. Send stops the recorder and uploads the WHOLE clip once; the transcript comes
 * back as one piece of text. The level meter is display only: it never decides what is
 * uploaded (there is no silence gate), and a flat meter (a suspended AudioContext) does not
 * stop the recording.
 *
 * The session is a plain state machine with injected browser APIs, so it runs without a
 * browser in unit tests. The writer turns its views into UI; nothing here knows about Svelte.
 */

/** VM-8: a clip is sent automatically at this length. */
export const VOICE_MESSAGE_MAX_MS = 5 * 60 * 1000
/** VM-2: how often the recorder hands over audio (chunks stay in memory). */
export const VOICE_TIMESLICE_MS = 1000
/** VM-2: recorder bitrate hint; the server's upload limit is sized from it. */
export const VOICE_AUDIO_BITS_PER_SECOND = 32_000
/**
 * Bars kept for the scrolling waveform (≈ 12.8 s of history). More than a phone shows: the
 * bar clips the oldest on the left, so a wide desktop field fills and a narrow one just scrolls.
 */
export const WAVEFORM_BARS = 160
/** How often the "Transcribing… 0:12" counter is refreshed while the upload waits. */
export const TRANSCRIBING_TICK_MS = 250
/** How often the mic level is read for the waveform and the timer. */
export const WAVEFORM_INTERVAL_MS = 80

/** VM-2: MIME types in order of preference; none supported means the recorder's own default. */
const PREFERRED_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/mp4'] as const

export type VoiceFailureReason =
  /** The user (or the browser) denied microphone access. */
  | 'permission'
  /** No usable microphone. */
  | 'microphone'
  /** The recorder failed, or produced no audio. */
  | 'recorder'
  /** The browser ended the recording by itself (a call, an unplugged mic). */
  | 'interrupted'
  /** The clip was transcribed to nothing. */
  | 'empty'
  /** The transcribe request failed. */
  | 'request'

export type VoiceFailure = {
  reason: VoiceFailureReason
  /** The server's message for a failed request. */
  detail?: string
  /** The HTTP status of a failed request; absent when the network itself failed. */
  status?: number
  /** The clip is still in memory: Retry uploads it again. */
  retryable: boolean
}

export type VoiceMessagePhase = 'idle' | 'starting' | 'recording' | 'transcribing' | 'failed'

export type VoiceMessageView = {
  phase: VoiceMessagePhase
  /** Length of the clip so far (frozen once it is sent). */
  elapsedMs: number
  /** The last {@link WAVEFORM_BARS} mic levels (0–1), oldest first. */
  levels: readonly number[]
  /** How long the upload has been waiting for its transcript (0 outside `transcribing`). */
  transcribingElapsedMs: number
  /** Set only in the `failed` phase. */
  failure: VoiceFailure | null
}

/** The browser APIs the session uses; the defaults read the real globals at call time. */
export type VoiceMessageDeps = {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>
  createRecorder: (stream: MediaStream, options: MediaRecorderOptions) => MediaRecorder
  isTypeSupported: (mimeType: string) => boolean
  /** `null` where there is no AudioContext: the waveform stays flat, the recording works. */
  createAudioContext: () => AudioContext | null
  now: () => number
}

export type VoiceMessageOptions = {
  /** Uploads the whole clip once and returns its transcript (`''` = no speech). */
  transcribe: (clip: Blob, signal: AbortSignal) => Promise<string>
  /** Every change of the view: the writer renders from this. */
  onchange?: (view: VoiceMessageView) => void
  /** The microphone is open and recording. */
  onstart?: () => void
  /** The microphone was released (sent, discarded or failed); once per recording. */
  onstop?: () => void
  /** Once per successful clip, after the session is idle again. */
  ontranscript?: (text: string) => void
  /** Each time a message fails. */
  onerror?: (failure: VoiceFailure) => void
  deps?: Partial<VoiceMessageDeps>
}

export type VoiceMessageSession = {
  view(): VoiceMessageView
  /** Tap on the mic. Its synchronous part must run inside the tap (the AudioContext is made there). */
  start(): Promise<void>
  /** Stop recording and upload the clip; on success `ontranscript` follows. */
  send(): Promise<void>
  /** Drop the clip wherever it is (recording, uploading, failed). Nothing is uploaded. */
  discard(): void
  /** Upload the kept clip again after a failure. */
  retry(): Promise<void>
  /** The writer went away: discard without a word. */
  destroy(): void
}

function browserDeps(): VoiceMessageDeps {
  return {
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    createRecorder: (stream, options) => new MediaRecorder(stream, options),
    isTypeSupported: (mimeType) => MediaRecorder.isTypeSupported(mimeType),
    createAudioContext: () => (typeof AudioContext === 'undefined' ? null : new AudioContext()),
    now: () => performance.now(),
  }
}

/** Whether this browser can record at all (the mic button is disabled where it cannot). */
export function isVoiceRecordingSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined'
  )
}

/** RMS of 8-bit time-domain samples, scaled to 0–1 (a speaking voice sits around 0.2–0.8). */
export function micLevelFromSamples(samples: Uint8Array): number {
  let sumSq = 0
  for (const sample of samples) {
    const normalized = (sample - 128) / 128
    sumSq += normalized * normalized
  }
  return Math.min(1, Math.sqrt(sumSq / samples.length) * 4)
}

/** `m:ss`, floored to whole seconds. */
export function formatVoiceTimer(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

const SILENT_LEVELS: readonly number[] = Object.freeze(Array<number>(WAVEFORM_BARS).fill(0))

export const IDLE_VOICE_VIEW: VoiceMessageView = {
  phase: 'idle',
  elapsedMs: 0,
  levels: SILENT_LEVELS,
  transcribingElapsedMs: 0,
  failure: null,
}

const MIC_DENIED = new Set(['NotAllowedError', 'SecurityError', 'PermissionDeniedError'])

export function createVoiceMessageSession(options: VoiceMessageOptions): VoiceMessageSession {
  const deps: VoiceMessageDeps = { ...browserDeps(), ...options.deps }

  let view: VoiceMessageView = IDLE_VOICE_VIEW
  /** Bumped whenever a message ends, so a late answer for an older one is dropped. */
  let epoch = 0
  let silent = false

  let stream: MediaStream | null = null
  let recorder: MediaRecorder | null = null
  let chunks: Blob[] = []
  /** The assembled clip, kept in memory until it is transcribed or discarded. */
  let clip: Blob | null = null
  let micOpen = false
  let startedAt = 0
  let levels: number[] = [...SILENT_LEVELS]
  let upload: AbortController | null = null

  let audioContext: AudioContext | null = null
  let analyser: AnalyserNode | null = null
  let samples: Uint8Array<ArrayBuffer> | null = null
  let tickTimer: ReturnType<typeof setInterval> | null = null
  let capTimer: ReturnType<typeof setTimeout> | null = null
  let waitTimer: ReturnType<typeof setInterval> | null = null

  function emit(next: Partial<VoiceMessageView>): void {
    view = { ...view, ...next }
    if (!silent) options.onchange?.(view)
  }

  function goIdle(): void {
    stopWaitTimer()
    levels = [...SILENT_LEVELS]
    view = IDLE_VOICE_VIEW
    if (!silent) options.onchange?.(view)
  }

  /* ————— the microphone, the meter, the timers ————— */

  function stopTimers(): void {
    if (tickTimer !== null) clearInterval(tickTimer)
    if (capTimer !== null) clearTimeout(capTimer)
    tickTimer = null
    capTimer = null
  }

  function stopWaitTimer(): void {
    if (waitTimer !== null) clearInterval(waitTimer)
    waitTimer = null
  }

  function closeAudioContext(): void {
    analyser = null
    samples = null
    if (audioContext) {
      void audioContext.close().catch(() => {
        // display-only meter: nothing waits on it
      })
      audioContext = null
    }
  }

  /** The tap handler's synchronous half: iOS only lets an AudioContext start inside the gesture. */
  function openAudioContext(): void {
    try {
      const context = deps.createAudioContext()
      if (!context) return
      audioContext = context
      // a context that stays suspended only means a flat waveform; the recording does not depend on it
      void context.resume().catch(() => {})
    } catch (err) {
      audioContext = null
      console.warn('voice waveform unavailable', err)
    }
  }

  function attachMeter(mediaStream: MediaStream): void {
    if (!audioContext) return
    try {
      const source = audioContext.createMediaStreamSource(mediaStream)
      const node = audioContext.createAnalyser()
      node.fftSize = 1024
      node.smoothingTimeConstant = 0.8
      source.connect(node)
      analyser = node
      samples = new Uint8Array(node.fftSize)
    } catch (err) {
      analyser = null
      samples = null
      console.warn('voice waveform unavailable', err)
    }
  }

  function readLevel(): number {
    if (!analyser || !samples) return 0
    analyser.getByteTimeDomainData(samples)
    return micLevelFromSamples(samples)
  }

  function tick(): void {
    levels = [...levels.slice(1), readLevel()]
    emit({ elapsedMs: deps.now() - startedAt, levels })
  }

  /** Releases the microphone; `onstop` fires once for every recording that began. */
  function releaseMicrophone(): void {
    if (stream) {
      for (const track of stream.getTracks()) track.stop()
      stream = null
    }
    if (micOpen) {
      micOpen = false
      if (!silent) options.onstop?.()
    }
  }

  function detachRecorder(): MediaRecorder | null {
    const current = recorder
    recorder = null
    if (current) {
      current.ondataavailable = null
      current.onerror = null
      current.onstop = null
    }
    return current
  }

  /** Everything a recording holds, dropped: recorder, meter, timers, mic. */
  function teardownCapture(): void {
    stopTimers()
    const current = detachRecorder()
    if (current && current.state !== 'inactive') {
      try {
        current.stop()
      } catch {
        // already inactive
      }
    }
    closeAudioContext()
    releaseMicrophone()
  }

  /* ————— the clip ————— */

  function assembleClip(from: MediaRecorder | null): Blob | null {
    const parts = chunks
    chunks = []
    if (parts.length === 0) return null
    const type = from?.mimeType || parts[0]?.type
    if (!type) return null
    return new Blob(parts, { type })
  }

  function fail(failure: VoiceFailure): void {
    stopTimers()
    stopWaitTimer()
    closeAudioContext()
    releaseMicrophone()
    emit({ phase: 'failed', failure })
    if (!silent) options.onerror?.(failure)
  }

  async function uploadClip(forEpoch: number): Promise<void> {
    if (!clip) return
    const controller = new AbortController()
    upload = controller
    // the wait is shown live, ticked by the session's own timer (the server may retry 3 × 60 s)
    const waitStart = deps.now()
    stopWaitTimer()
    waitTimer = setInterval(
      () => emit({ transcribingElapsedMs: deps.now() - waitStart }),
      TRANSCRIBING_TICK_MS,
    )
    emit({ phase: 'transcribing', transcribingElapsedMs: 0, failure: null })
    let transcript: string
    try {
      transcript = await options.transcribe(clip, controller.signal)
    } catch (err) {
      if (forEpoch !== epoch) return
      upload = null
      const status =
        err !== null && typeof err === 'object' && 'status' in err && typeof err.status === 'number'
          ? err.status
          : undefined
      fail({
        reason: 'request',
        ...(status === undefined ? {} : { status }),
        detail: err instanceof Error ? err.message : String(err),
        retryable: true,
      })
      return
    }
    if (forEpoch !== epoch) return
    upload = null
    stopWaitTimer()
    const text = transcript.trim()
    if (!text) {
      fail({ reason: 'empty', retryable: true })
      return
    }
    clip = null
    epoch += 1
    goIdle()
    if (!silent) options.ontranscript?.(text)
  }

  /* ————— the public actions ————— */

  async function start(): Promise<void> {
    if (view.phase !== 'idle') return
    const mine = ++epoch
    // VM-3: made and resumed here, synchronously in the tap — before the first await
    openAudioContext()
    emit({ phase: 'starting', elapsedMs: 0, levels: [...SILENT_LEVELS], failure: null })

    let mediaStream: MediaStream
    try {
      mediaStream = await deps.getUserMedia({ audio: true })
    } catch (err) {
      if (mine !== epoch) return
      const name = err !== null && typeof err === 'object' && 'name' in err ? String(err.name) : ''
      fail({ reason: MIC_DENIED.has(name) ? 'permission' : 'microphone', retryable: false })
      return
    }
    if (mine !== epoch) {
      // discarded while the permission prompt was open
      for (const track of mediaStream.getTracks()) track.stop()
      return
    }

    stream = mediaStream
    attachMeter(mediaStream)
    const mimeType = PREFERRED_MIME_TYPES.find((type) => deps.isTypeSupported(type))
    let current: MediaRecorder
    try {
      current = deps.createRecorder(mediaStream, {
        audioBitsPerSecond: VOICE_AUDIO_BITS_PER_SECOND,
        ...(mimeType ? { mimeType } : {}),
      })
    } catch (err) {
      console.error('voice recorder could not start', err)
      fail({ reason: 'recorder', retryable: false })
      return
    }
    recorder = current
    chunks = []
    clip = null
    current.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    current.onerror = () => {
      detachRecorder()
      if (current.state !== 'inactive') current.stop()
      chunks = []
      fail({ reason: 'recorder', retryable: false })
    }
    current.onstop = () => {
      // not ours (send and discard detach this first): the browser ended the recording
      if (view.phase !== 'recording') return
      detachRecorder()
      clip = assembleClip(current)
      fail({ reason: 'interrupted', retryable: clip !== null })
    }
    current.start(VOICE_TIMESLICE_MS)
    micOpen = true
    startedAt = deps.now()
    tickTimer = setInterval(tick, WAVEFORM_INTERVAL_MS)
    capTimer = setTimeout(() => void send(), VOICE_MESSAGE_MAX_MS)
    emit({ phase: 'recording', elapsedMs: 0 })
    options.onstart?.()
  }

  async function send(): Promise<void> {
    if (view.phase !== 'recording') return
    const mine = epoch
    stopTimers()
    // the waveform and the timer freeze where the clip ended
    emit({ phase: 'transcribing', elapsedMs: deps.now() - startedAt })
    closeAudioContext()
    const current = detachRecorder()
    if (current && current.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        current.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data)
        }
        current.onstop = () => resolve()
        current.stop()
      })
    }
    if (mine !== epoch) return
    releaseMicrophone()
    clip = assembleClip(current)
    if (!clip) {
      fail({ reason: 'recorder', retryable: false })
      return
    }
    await uploadClip(mine)
  }

  async function retry(): Promise<void> {
    if (view.phase !== 'failed' || !view.failure?.retryable || !clip) return
    await uploadClip(epoch)
  }

  function discard(): void {
    if (view.phase === 'idle') return
    epoch += 1
    upload?.abort()
    upload = null
    teardownCapture()
    chunks = []
    clip = null
    goIdle()
  }

  function destroy(): void {
    silent = true
    discard()
  }

  return { view: () => view, start, send, discard, retry, destroy }
}
