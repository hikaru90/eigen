import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FakeAudioContext,
  FakeMediaRecorder,
  fakeStream,
  micSignal,
} from '$lib/test/voice-doubles'
import { TranscribeRequestError } from './transcribe-audio'
import {
  createVoiceMessageSession,
  formatVoiceTimer,
  micLevelFromSamples,
  VOICE_AUDIO_BITS_PER_SECOND,
  VOICE_MESSAGE_MAX_MS,
  VOICE_TIMESLICE_MS,
  WAVEFORM_BARS,
  WAVEFORM_INTERVAL_MS,
  type VoiceMessageView,
} from './voice-message'

/**
 * The voice-message session (docs/planning/feature-voice-message-stt.md): one recorder per
 * tap, the whole clip uploaded once on send, the clip kept in memory until it is
 * transcribed or discarded. Everything below runs on fakes — no mic, no network.
 */

function setup(options?: { transcribe?: (clip: Blob, signal: AbortSignal) => Promise<string> }) {
  const log: string[] = []
  const stream = fakeStream()
  const getUserMedia = vi.fn(async () => {
    log.push('getUserMedia')
    return stream
  })
  const transcribe = vi.fn(options?.transcribe ?? (async () => 'hello world'))
  const views: VoiceMessageView[] = []
  const events = {
    onchange: vi.fn((view: VoiceMessageView) => views.push(view)),
    onstart: vi.fn(),
    onstop: vi.fn(),
    ontranscript: vi.fn(),
    onerror: vi.fn(),
  }
  const session = createVoiceMessageSession({
    transcribe,
    ...events,
    deps: {
      getUserMedia,
      createRecorder: (s, o) => new FakeMediaRecorder(s, o) as unknown as MediaRecorder,
      isTypeSupported: FakeMediaRecorder.isTypeSupported,
      createAudioContext: () => {
        log.push('audioContext')
        return new FakeAudioContext() as unknown as AudioContext
      },
      now: () => Date.now(),
    },
  })
  return { session, stream, getUserMedia, transcribe, events, views, log }
}

function recorder(index = 0): FakeMediaRecorder {
  const found = FakeMediaRecorder.instances[index]
  if (!found) throw new Error(`no recorder #${index}`)
  return found
}

async function bytesOf(blob: Blob): Promise<number[]> {
  return [...new Uint8Array(await blob.arrayBuffer())]
}

const flush = () => vi.advanceTimersByTimeAsync(0)

describe('voice message session', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeMediaRecorder.reset()
    FakeAudioContext.reset()
    micSignal.loud = false
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('starting (VM-2, VM-3)', () => {
    it('creates and resumes the AudioContext synchronously in the tap, before any await', () => {
      const { session, getUserMedia, log } = setup()
      // not awaited: this is exactly what the click handler runs before yielding
      void session.start()
      expect(log).toEqual(['audioContext', 'getUserMedia'])
      expect(FakeAudioContext.instances).toHaveLength(1)
      expect(FakeAudioContext.instances[0]!.resume).toHaveBeenCalledTimes(1)
      expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
    })

    it('goes idle -> starting (permission prompt) -> recording and announces the start once', async () => {
      const { session, events, views } = setup()
      expect(session.view().phase).toBe('idle')
      const started = session.start()
      expect(session.view().phase).toBe('starting')
      await started
      expect(session.view().phase).toBe('recording')
      expect(views.map((v) => v.phase)).toEqual(['starting', 'recording'])
      expect(events.onstart).toHaveBeenCalledTimes(1)
    })

    it('makes no request while recording (AC-1)', async () => {
      const { session, transcribe } = setup()
      await session.start()
      await vi.advanceTimersByTimeAsync(10_000)
      expect(transcribe).not.toHaveBeenCalled()
    })

    it('records with one MediaRecorder per tap: timeslice 1000 ms, 32 kbps', async () => {
      const { session } = setup()
      await session.start()
      expect(FakeMediaRecorder.instances).toHaveLength(1)
      expect(recorder().startCalls).toEqual([VOICE_TIMESLICE_MS])
      expect(VOICE_TIMESLICE_MS).toBe(1000)
      expect(recorder().options?.audioBitsPerSecond).toBe(VOICE_AUDIO_BITS_PER_SECOND)
      expect(VOICE_AUDIO_BITS_PER_SECOND).toBe(32_000)
    })

    it('prefers audio/webm;codecs=opus, then audio/mp4, then the recorder default', async () => {
      FakeMediaRecorder.supported = new Set(['audio/webm;codecs=opus', 'audio/mp4'])
      const webm = setup()
      await webm.session.start()
      expect(recorder(0).options?.mimeType).toBe('audio/webm;codecs=opus')

      FakeMediaRecorder.supported = new Set(['audio/mp4'])
      const mp4 = setup()
      await mp4.session.start()
      expect(recorder(1).options?.mimeType).toBe('audio/mp4')

      FakeMediaRecorder.supported = new Set()
      const bare = setup()
      await bare.session.start()
      expect(recorder(2).options).not.toHaveProperty('mimeType')
      expect(recorder(2).options?.audioBitsPerSecond).toBe(32_000)
    })

    it('asks for the microphone fresh on every tap and uses a new recorder each time', async () => {
      const { session, getUserMedia } = setup()
      await session.start()
      session.discard()
      await session.start()
      expect(getUserMedia).toHaveBeenCalledTimes(2)
      expect(FakeMediaRecorder.instances).toHaveLength(2)
      expect(FakeAudioContext.instances).toHaveLength(2)
    })

    it('ignores a second tap while a message is in progress', async () => {
      const { session, getUserMedia } = setup()
      await session.start()
      await session.start()
      expect(getUserMedia).toHaveBeenCalledTimes(1)
    })

    it('a denied microphone fails the message without a clip and releases the audio context', async () => {
      const { session, events, getUserMedia } = setup()
      getUserMedia.mockRejectedValueOnce(
        Object.assign(new Error('denied'), { name: 'NotAllowedError' }),
      )
      await session.start()
      expect(session.view()).toMatchObject({
        phase: 'failed',
        failure: { reason: 'permission', retryable: false },
      })
      expect(events.onerror).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'permission' }),
      )
      expect(events.onstart).not.toHaveBeenCalled()
      expect(FakeMediaRecorder.instances).toHaveLength(0)
      expect(FakeAudioContext.instances[0]!.close).toHaveBeenCalled()
      // dismissing it brings the field back
      session.discard()
      expect(session.view().phase).toBe('idle')
    })

    it('any other getUserMedia failure is a microphone error, never a silent nothing', async () => {
      const { session, getUserMedia } = setup()
      getUserMedia.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NotFoundError' }))
      await session.start()
      expect(session.view().failure).toMatchObject({ reason: 'microphone', retryable: false })
    })

    it('stops the tracks when the clip was discarded while the permission prompt was open', async () => {
      const { session, stream, getUserMedia } = setup()
      let grant: (s: MediaStream) => void = () => {}
      getUserMedia.mockImplementationOnce(() => new Promise<MediaStream>((r) => (grant = r)))
      const started = session.start()
      session.discard()
      grant(stream)
      await started
      expect(session.view().phase).toBe('idle')
      for (const track of stream.tracks) expect(track.stop).toHaveBeenCalled()
      expect(FakeMediaRecorder.instances).toHaveLength(0)
    })
  })

  describe('the waveform is display only (VM-3, AC-7)', () => {
    it('scrolls the mic level in on the right, one bar per tick', async () => {
      const { session } = setup()
      await session.start()
      expect(session.view().levels).toHaveLength(WAVEFORM_BARS)
      expect(session.view().levels.every((l) => l === 0)).toBe(true)

      micSignal.loud = true
      await vi.advanceTimersByTimeAsync(WAVEFORM_INTERVAL_MS * 3)
      const levels = session.view().levels
      expect(levels).toHaveLength(WAVEFORM_BARS)
      expect(levels.slice(-3).every((l) => l > 0.5)).toBe(true)
      expect(levels.slice(0, WAVEFORM_BARS - 3).every((l) => l === 0)).toBe(true)

      micSignal.loud = false
      await vi.advanceTimersByTimeAsync(WAVEFORM_INTERVAL_MS)
      expect(session.view().levels.at(-1)).toBe(0)
      expect(session.view().levels.at(-2)).toBeGreaterThan(0.5)
    })

    it('counts the elapsed time while recording', async () => {
      const { session } = setup()
      await session.start()
      await vi.advanceTimersByTimeAsync(7_000)
      expect(session.view().elapsedMs).toBeGreaterThanOrEqual(6_900)
      expect(session.view().elapsedMs).toBeLessThanOrEqual(7_100)
    })

    it('uploads a clip of very quiet speech: there is no level gate (AC-7)', async () => {
      const { session, transcribe } = setup()
      await session.start()
      // flat silence the whole time, like a suspended iOS AudioContext reads
      micSignal.loud = false
      recorder().emitChunk([1, 2, 3])
      await vi.advanceTimersByTimeAsync(3_000)
      await session.send()
      expect(transcribe).toHaveBeenCalledTimes(1)
      expect(session.view().levels.every((l) => l === 0)).toBe(true)
    })

    it('still records when the audio context is unavailable (flat waveform)', async () => {
      const stream = fakeStream()
      const session = createVoiceMessageSession({
        transcribe: async () => 'ok',
        deps: {
          getUserMedia: async () => stream,
          createRecorder: (s, o) => new FakeMediaRecorder(s, o) as unknown as MediaRecorder,
          isTypeSupported: FakeMediaRecorder.isTypeSupported,
          createAudioContext: () => null,
          now: () => Date.now(),
        },
      })
      await session.start()
      expect(session.view().phase).toBe('recording')
      expect(recorder().state).toBe('recording')
    })
  })

  describe('send (VM-4, AC-2)', () => {
    it('uploads the whole clip once, then emits the transcript once and goes idle', async () => {
      const { session, transcribe, events, stream } = setup()
      await session.start()
      recorder().emitChunk([1, 2, 3])
      recorder().emitChunk([4, 5])
      await session.send()

      expect(transcribe).toHaveBeenCalledTimes(1)
      const clip = transcribe.mock.calls[0]![0]
      // every timeslice in order, plus what the recorder flushed on stop
      expect(await bytesOf(clip)).toEqual([1, 2, 3, 4, 5, 0xee, 0xee])
      expect(clip.type).toBe('audio/webm;codecs=opus')
      expect(transcribe.mock.calls[0]![1]).toBeInstanceOf(AbortSignal)

      expect(events.ontranscript).toHaveBeenCalledTimes(1)
      expect(events.ontranscript).toHaveBeenCalledWith('hello world')
      expect(session.view().phase).toBe('idle')
      for (const track of stream.tracks) expect(track.stop).toHaveBeenCalled()
      expect(events.onstop).toHaveBeenCalledTimes(1)
      expect(FakeAudioContext.instances[0]!.close).toHaveBeenCalled()
    })

    it('shows the transcribing state (frozen waveform) while the upload runs, nothing else', async () => {
      let finish: (text: string) => void = () => {}
      const { session, events } = setup({
        transcribe: () => new Promise<string>((r) => (finish = r)),
      })
      await session.start()
      micSignal.loud = true
      await vi.advanceTimersByTimeAsync(WAVEFORM_INTERVAL_MS * 2)
      recorder().emitChunk([1])
      const sending = session.send()
      await flush()
      const view = session.view()
      expect(view.phase).toBe('transcribing')
      const frozen = view.levels
      // time passes, the waveform and timer stay where they stopped
      await vi.advanceTimersByTimeAsync(2_000)
      expect(session.view().levels).toEqual(frozen)
      expect(session.view().elapsedMs).toBe(view.elapsedMs)
      expect(events.ontranscript).not.toHaveBeenCalled()
      // the microphone is already released
      expect(recorder().state).toBe('inactive')
      finish('done')
      await sending
      expect(events.ontranscript).toHaveBeenCalledWith('done')
    })

    it('trims the transcript', async () => {
      const { session, events } = setup({ transcribe: async () => '  spoken words \n' })
      await session.start()
      recorder().emitChunk([1])
      await session.send()
      expect(events.ontranscript).toHaveBeenCalledWith('spoken words')
    })

    it('sends only once: a second send while transcribing or idle is ignored', async () => {
      const { session, transcribe } = setup()
      await session.send() // idle
      expect(transcribe).not.toHaveBeenCalled()
      await session.start()
      recorder().emitChunk([1])
      await Promise.all([session.send(), session.send()])
      expect(transcribe).toHaveBeenCalledTimes(1)
    })

    it('a recorder with no audio at all is a recording failure, not an empty upload', async () => {
      FakeMediaRecorder.tail = []
      const { session, transcribe } = setup()
      await session.start()
      await session.send()
      expect(transcribe).not.toHaveBeenCalled()
      expect(session.view().failure).toMatchObject({ reason: 'recorder', retryable: false })
    })
  })

  describe('discard (VM-5, AC-3)', () => {
    it('stops the recorder, drops the clip, uploads nothing and releases the mic', async () => {
      const { session, transcribe, events, stream } = setup()
      await session.start()
      recorder().emitChunk([1, 2, 3])
      session.discard()
      await vi.advanceTimersByTimeAsync(5_000)
      expect(transcribe).not.toHaveBeenCalled()
      expect(events.ontranscript).not.toHaveBeenCalled()
      expect(session.view().phase).toBe('idle')
      expect(recorder().state).toBe('inactive')
      for (const track of stream.tracks) expect(track.stop).toHaveBeenCalledTimes(1)
      expect(events.onstop).toHaveBeenCalledTimes(1)
      expect(FakeAudioContext.instances[0]!.close).toHaveBeenCalled()
    })

    it('is idempotent', async () => {
      const { session, events, stream } = setup()
      await session.start()
      session.discard()
      session.discard()
      expect(events.onstop).toHaveBeenCalledTimes(1)
      for (const track of stream.tracks) expect(track.stop).toHaveBeenCalledTimes(1)
    })

    it('discarding while the clip is transcribing aborts the upload and drops its late result', async () => {
      let signal: AbortSignal | undefined
      let finish: (text: string) => void = () => {}
      const { session, events } = setup({
        transcribe: (_clip, s) => {
          signal = s
          return new Promise<string>((r) => (finish = r))
        },
      })
      await session.start()
      recorder().emitChunk([1])
      const sending = session.send()
      await flush()
      expect(session.view().phase).toBe('transcribing')
      session.discard()
      expect(signal?.aborted).toBe(true)
      expect(session.view().phase).toBe('idle')
      finish('too late')
      await sending
      expect(events.ontranscript).not.toHaveBeenCalled()
      expect(session.view().phase).toBe('idle')
    })

    it('leaves the session reusable: the next tap records afresh', async () => {
      const { session, transcribe } = setup()
      await session.start()
      recorder(0).emitChunk([9, 9, 9, 9])
      session.discard()
      await session.start()
      recorder(1).emitChunk([1])
      await session.send()
      expect(await bytesOf(transcribe.mock.calls[0]![0])).toEqual([1, 0xee, 0xee])
    })
  })

  describe('failure keeps the clip (VM-6, VM-7, AC-4..6)', () => {
    it('a failed request shows the error, submits nothing and keeps the clip for Retry', async () => {
      const transcribe = vi
        .fn<(clip: Blob, signal: AbortSignal) => Promise<string>>()
        .mockRejectedValueOnce(new TranscribeRequestError(502, 'Transcription failed'))
        .mockResolvedValueOnce('second try')
      const { session, events } = setup({ transcribe })
      await session.start()
      recorder().emitChunk([1, 2])
      await session.send()

      expect(session.view().phase).toBe('failed')
      expect(session.view().failure).toEqual({
        reason: 'request',
        status: 502,
        detail: 'Transcription failed',
        retryable: true,
      })
      expect(events.onerror).toHaveBeenCalledTimes(1)
      expect(events.ontranscript).not.toHaveBeenCalled()
      // the microphone is not held while the error shows
      expect(recorder().state).toBe('inactive')

      await session.retry()
      // Retry uploads the same clip again — not a new recording
      expect(transcribe).toHaveBeenCalledTimes(2)
      expect(transcribe.mock.calls[1]![0]).toBe(transcribe.mock.calls[0]![0])
      expect(FakeMediaRecorder.instances).toHaveLength(1)
      expect(events.ontranscript).toHaveBeenCalledTimes(1)
      expect(events.ontranscript).toHaveBeenCalledWith('second try')
      expect(session.view().phase).toBe('idle')
    })

    it('shows the transcribing state again while a retry runs', async () => {
      let finish: (text: string) => void = () => {}
      const transcribe = vi
        .fn<(clip: Blob, signal: AbortSignal) => Promise<string>>()
        .mockRejectedValueOnce(new Error('network down'))
        .mockImplementationOnce(() => new Promise<string>((r) => (finish = r)))
      const { session } = setup({ transcribe })
      await session.start()
      recorder().emitChunk([1])
      await session.send()
      expect(session.view().failure).toMatchObject({ reason: 'request', retryable: true })
      const retrying = session.retry()
      await flush()
      expect(session.view().phase).toBe('transcribing')
      expect(session.view().failure).toBeNull()
      finish('ok')
      await retrying
    })

    it('keeps the status and the billing message of a 402 (AC-5) and submits nothing', async () => {
      const { session, events } = setup({
        transcribe: async () => {
          throw new TranscribeRequestError(402, 'Insufficient credits')
        },
      })
      await session.start()
      recorder().emitChunk([1])
      await session.send()
      expect(session.view().failure).toMatchObject({
        reason: 'request',
        status: 402,
        detail: 'Insufficient credits',
      })
      expect(events.ontranscript).not.toHaveBeenCalled()
    })

    it('an empty transcript is "no speech": nothing is submitted, Retry/Discard stay (AC-6)', async () => {
      const { session, events, transcribe } = setup({ transcribe: async () => '   ' })
      await session.start()
      recorder().emitChunk([1])
      await session.send()
      expect(session.view().phase).toBe('failed')
      expect(session.view().failure).toEqual({ reason: 'empty', retryable: true })
      expect(events.ontranscript).not.toHaveBeenCalled()
      await session.retry()
      expect(transcribe).toHaveBeenCalledTimes(2)
    })

    it('Discard on the error drops the clip and brings the field back', async () => {
      const { session, transcribe } = setup({
        transcribe: async () => {
          throw new Error('boom')
        },
      })
      await session.start()
      recorder().emitChunk([1])
      await session.send()
      session.discard()
      expect(session.view().phase).toBe('idle')
      await session.retry() // nothing to retry any more
      expect(transcribe).toHaveBeenCalledTimes(1)
    })

    it('retry is only for a failed message that still has its clip', async () => {
      const { session, transcribe, getUserMedia } = setup()
      await session.retry()
      await session.start()
      await session.retry()
      expect(transcribe).not.toHaveBeenCalled()
      expect(getUserMedia).toHaveBeenCalledTimes(1)
    })

    it('a recorder error drops the clip: failed, not retryable', async () => {
      const { session, events, stream } = setup()
      await session.start()
      recorder().emitChunk([1])
      recorder().fail()
      expect(session.view().failure).toMatchObject({ reason: 'recorder', retryable: false })
      expect(events.onerror).toHaveBeenCalledTimes(1)
      for (const track of stream.tracks) expect(track.stop).toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(VOICE_MESSAGE_MAX_MS + 1)
      expect(events.ontranscript).not.toHaveBeenCalled()
    })

    it('an interrupted recording (the browser stopped it) keeps what was recorded for Retry', async () => {
      const { session, transcribe, events } = setup()
      await session.start()
      recorder().emitChunk([7, 8])
      recorder().interrupt()
      expect(session.view().failure).toMatchObject({ reason: 'interrupted', retryable: true })
      expect(events.onerror).toHaveBeenCalledTimes(1)
      await session.retry()
      expect(await bytesOf(transcribe.mock.calls[0]![0])).toEqual([7, 8])
    })
  })

  describe('length cap (VM-8, AC-8)', () => {
    it('is five minutes', () => {
      expect(VOICE_MESSAGE_MAX_MS).toBe(5 * 60 * 1000)
    })

    it('sends the clip automatically at the cap, as if Send was tapped', async () => {
      const { session, transcribe, events } = setup()
      await session.start()
      recorder().emitChunk([1])
      await vi.advanceTimersByTimeAsync(VOICE_MESSAGE_MAX_MS - 1)
      expect(session.view().phase).toBe('recording')
      expect(transcribe).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(transcribe).toHaveBeenCalledTimes(1)
      expect(events.ontranscript).toHaveBeenCalledWith('hello world')
    })

    it('a message sent by hand cancels the cap (no second send later)', async () => {
      const { session, transcribe } = setup()
      await session.start()
      recorder().emitChunk([1])
      await session.send()
      await vi.advanceTimersByTimeAsync(VOICE_MESSAGE_MAX_MS * 2)
      expect(transcribe).toHaveBeenCalledTimes(1)
    })

    it('a discarded message cancels the cap too', async () => {
      const { session, transcribe } = setup()
      await session.start()
      session.discard()
      await vi.advanceTimersByTimeAsync(VOICE_MESSAGE_MAX_MS * 2)
      expect(transcribe).not.toHaveBeenCalled()
    })
  })

  describe('destroy', () => {
    it('releases everything and stays silent: leaving the page drops the clip', async () => {
      const { session, events, stream, transcribe } = setup()
      await session.start()
      recorder().emitChunk([1])
      const changes = events.onchange.mock.calls.length
      session.destroy()
      for (const track of stream.tracks) expect(track.stop).toHaveBeenCalled()
      expect(recorder().state).toBe('inactive')
      await vi.advanceTimersByTimeAsync(VOICE_MESSAGE_MAX_MS * 2)
      expect(transcribe).not.toHaveBeenCalled()
      expect(events.onchange.mock.calls.length).toBe(changes)
      expect(events.ontranscript).not.toHaveBeenCalled()
    })

    it('aborts a running upload and ignores its late answer', async () => {
      let signal: AbortSignal | undefined
      let finish: (text: string) => void = () => {}
      const { session, events } = setup({
        transcribe: (_c, s) => {
          signal = s
          return new Promise<string>((r) => (finish = r))
        },
      })
      await session.start()
      recorder().emitChunk([1])
      const sending = session.send()
      await flush()
      session.destroy()
      expect(signal?.aborted).toBe(true)
      finish('late')
      await sending
      expect(events.ontranscript).not.toHaveBeenCalled()
    })
  })
})

describe('micLevelFromSamples', () => {
  it('is 0 for the 8-bit midpoint (silence) and 1 for a full-scale signal', () => {
    expect(micLevelFromSamples(new Uint8Array(64).fill(128))).toBe(0)
    const loud = new Uint8Array(64)
    for (let i = 0; i < loud.length; i++) loud[i] = i % 2 ? 255 : 0
    expect(micLevelFromSamples(loud)).toBe(1)
  })

  it('stays within 0..1', () => {
    const level = micLevelFromSamples(Uint8Array.from({ length: 64 }, (_, i) => 128 + (i % 3) * 10))
    expect(level).toBeGreaterThan(0)
    expect(level).toBeLessThanOrEqual(1)
  })
})

describe('formatVoiceTimer', () => {
  it('is m:ss, floored to whole seconds', () => {
    expect(formatVoiceTimer(0)).toBe('0:00')
    expect(formatVoiceTimer(999)).toBe('0:00')
    expect(formatVoiceTimer(7_400)).toBe('0:07')
    expect(formatVoiceTimer(65_000)).toBe('1:05')
    expect(formatVoiceTimer(VOICE_MESSAGE_MAX_MS)).toBe('5:00')
  })

  it('never goes negative', () => {
    expect(formatVoiceTimer(-5)).toBe('0:00')
  })
})
