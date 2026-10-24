<script lang="ts">
  import LoaderCircle from '@lucide/svelte/icons/loader-circle'
  import Mic from '@lucide/svelte/icons/mic'
  import Square from '@lucide/svelte/icons/square'
  import { onDestroy } from 'svelte'
  import { browser } from '$app/environment'
  import {
    createSegmentTranscriber,
    createSilenceCutter,
    micLevelFromSamples,
    type SegmentTranscriber,
    type SilenceCutter,
  } from '$lib/capture/segmented-stt'
  import { transcribeAudioChunk } from '$lib/capture/transcribe-audio'
  import { Button } from '$lib/components/ui/button'

  let {
    disabled = false,
    ontranscript,
    onpartialtranscript,
    onerror,
    onstop,
    onstart,
    // $bindable() sets up parent binding; ESLint cannot see the read before reassignment in handlers.
    // eslint-disable-next-line no-useless-assignment -- Svelte bindable prop
    stopRef = $bindable(),
    class: className = '',
  }: {
    disabled?: boolean
    ontranscript: (text: string) => void
    onpartialtranscript?: (text: string) => void
    onerror?: (message: string) => void
    onstop?: () => void
    onstart?: () => void
    stopRef?: (() => void) | undefined
    class?: string
  } = $props()

  /** How often the segment cutter samples the mic (interval, so it keeps running in background tabs). */
  const CUT_CHECK_MS = 50

  let recording = $state(false)
  let transcribing = $state(false)
  let stream: MediaStream | null = null
  /** Mic level 0–1 while recording. */
  let level = $state(0)

  /** Every segment gets its own MediaRecorder on the shared stream, so each upload is a standalone file. */
  let recorderOptions: MediaRecorderOptions | undefined
  let segmentIndex = 0
  /** Resolves when the most recently stopped recorder has handed its segment over. */
  let lastSegmentFlushed: Promise<void> = Promise.resolve()
  let transcriber: SegmentTranscriber | null = null
  let cutter: SilenceCutter | null = null
  let cutTimer: ReturnType<typeof setInterval> | null = null

  let audioContext: AudioContext | null = null
  let analyser: AnalyserNode | null = null
  let samples: Uint8Array<ArrayBuffer> | null = null
  let levelFrameId: number | null = null
  let levelSmooth = 0

  const busy = $derived(recording || transcribing)
  const micSupported = $derived(
    browser &&
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== 'undefined',
  )

  /** Per-bar gain: the middle bars rise most, so the meter reads as a voice, not a block. */
  const LEVEL_BARS = [0.7, 1.15, 1.4, 1.15, 0.7]

  /** 10% floor so the level bar is always slightly visible while recording. */
  const pulseSize = $derived(Math.round(10 + level * 90))

  function readMicLevel(): number {
    if (!analyser || !samples) return 0
    analyser.getByteTimeDomainData(samples)
    return micLevelFromSamples(samples)
  }

  function stopLevelMeter() {
    if (levelFrameId !== null) {
      cancelAnimationFrame(levelFrameId)
      levelFrameId = null
    }
    level = 0
    levelSmooth = 0
    analyser = null
    samples = null
    if (audioContext) {
      void audioContext.close()
      audioContext = null
    }
  }

  function startLevelMeter(mediaStream: MediaStream) {
    stopLevelMeter()
    if (typeof AudioContext === 'undefined') return

    audioContext = new AudioContext()
    const source = audioContext.createMediaStreamSource(mediaStream)
    analyser = audioContext.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.8
    source.connect(analyser)
    samples = new Uint8Array(analyser.fftSize)

    const tick = () => {
      if (!analyser) return
      const instant = readMicLevel()
      const smooth = instant > levelSmooth ? 0.2 : 0.08
      levelSmooth += (instant - levelSmooth) * smooth
      level = levelSmooth
      levelFrameId = requestAnimationFrame(tick)
    }

    void audioContext.resume()
    levelFrameId = requestAnimationFrame(tick)
  }

  function stopCutTimer() {
    if (cutTimer !== null) {
      clearInterval(cutTimer)
      cutTimer = null
    }
  }

  function releaseStream() {
    stopCutTimer()
    stopLevelMeter()
    if (stream) {
      for (const track of stream.getTracks()) track.stop()
    }
    stream = null
  }

  /** Opens a new segment: a fresh MediaRecorder on the same stream. */
  function openSegment(mediaStream: MediaStream) {
    const index = segmentIndex++
    const next = recorderOptions
      ? new MediaRecorder(mediaStream, recorderOptions)
      : new MediaRecorder(mediaStream)
    const parts: Blob[] = []
    next.ondataavailable = (ev) => {
      if (ev.data.size > 0) parts.push(ev.data)
    }
    next.onerror = () => failRecording('Recording failed')
    next.start()
    cutter?.restart(performance.now())
    return { recorder: next, index, parts }
  }

  let openSegmentState: ReturnType<typeof openSegment> | null = null

  /**
   * Stops the open segment's recorder and submits its whole file once it is flushed.
   * A segment whose mic level never reached speech is skipped, not uploaded.
   */
  function closeSegment(): Promise<void> {
    const segment = openSegmentState
    openSegmentState = null
    if (!segment) return Promise.resolve()
    const spoke = cutter?.heardSpeech() ?? true
    const flushed = new Promise<void>((resolve) => {
      segment.recorder.onstop = () => {
        const type = segment.recorder.mimeType || segment.parts[0]?.type || 'audio/webm'
        if (!spoke) {
          transcriber?.skip(segment.index)
        } else if (segment.parts.length > 0) {
          transcriber?.submit(segment.index, new Blob(segment.parts, { type }))
        }
        resolve()
      }
    })
    segment.recorder.stop()
    lastSegmentFlushed = flushed
    return flushed
  }

  function cutSegment() {
    if (!recording || !stream) return
    void closeSegment()
    openSegmentState = openSegment(stream)
  }

  function discardRecorder() {
    const segment = openSegmentState
    openSegmentState = null
    if (!segment) return
    segment.recorder.ondataavailable = null
    segment.recorder.onerror = null
    segment.recorder.onstop = null
    try {
      segment.recorder.stop()
    } catch {
      // already inactive
    }
  }

  /** Ends the session on an error: nothing partial survives in the parent's draft. */
  function failRecording(message: string) {
    if (!recording && !transcribing) return
    const wasRecording = recording
    recording = false
    transcribing = false
    stopRef = undefined
    transcriber?.abort()
    transcriber = null
    discardRecorder()
    releaseStream()
    onpartialtranscript?.('')
    if (wasRecording) onstop?.()
    onerror?.(message)
  }

  async function startRecording() {
    if (!micSupported || busy || disabled) return
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream = mediaStream
      startLevelMeter(mediaStream)
      const preferredMime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : MediaRecorder.isTypeSupported('audio/wav')
            ? 'audio/wav'
            : ''
      recorderOptions = preferredMime ? { mimeType: preferredMime } : undefined
      segmentIndex = 0
      transcriber = createSegmentTranscriber({
        transcribe: (blob, index, signal) =>
          transcribeAudioChunk(blob, { signal, segment: index }),
        onPartial: (text) => onpartialtranscript?.(text),
        onFatal: (message) => failRecording(message),
      })
      cutter = createSilenceCutter(performance.now())
      recording = true
      openSegmentState = openSegment(mediaStream)
      cutTimer = setInterval(() => {
        if (cutter?.feed(readMicLevel(), performance.now())) cutSegment()
      }, CUT_CHECK_MS)
      // Expose the stop function synchronously so the parent can stop an active
      // recording without waiting for a reactive tick (no $effect for control flow).
      stopRef = stopRecording
      onstart?.()
    } catch (err) {
      recording = false
      discardRecorder()
      releaseStream()
      const message =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Microphone permission denied'
          : err instanceof Error
            ? err.message
            : 'Could not access microphone'
      onerror?.(message)
    }
  }

  /** Stop button: close the last segment, wait for every segment, emit the joined transcript. */
  async function stopAndTranscribe() {
    if (!recording) return
    const session = transcriber
    recording = false
    transcribing = true
    // stopRef stays set until the final transcript is out: the shared writer keeps this
    // button mounted while it is set, and unmounting now would discard the last segment.
    stopCutTimer()
    stopLevelMeter()
    onstop?.()

    try {
      await closeSegment()
      await lastSegmentFlushed
      releaseStream()
      if (!session || transcriber !== session) return
      await finishSession(session)
    } finally {
      stopRef = undefined
    }
  }

  async function finishSession(session: NonNullable<typeof transcriber>) {
    try {
      const transcript = await session.finish()
      if (transcriber !== session) return
      transcriber = null
      transcribing = false
      if (!transcript) {
        onerror?.('No speech detected')
        return
      }
      ontranscript(transcript)
    } catch (err) {
      // fatal segment errors are already reported through onFatal → failRecording
      if (transcriber === session) {
        failRecording(err instanceof Error ? err.message : 'Transcription failed')
      }
    }
  }

  /** Parent-driven stop (focus, submit): discard the recording, upload nothing more. */
  function stopRecording() {
    if (!recording) return
    recording = false
    stopRef = undefined
    transcriber?.abort()
    transcriber = null
    discardRecorder()
    releaseStream()
    onstop?.()
  }

  async function toggleMic() {
    if (!micSupported) {
      onerror?.('Speech input is not supported in this browser')
      return
    }
    if (transcribing || disabled) return
    if (recording) {
      await stopAndTranscribe()
    } else {
      await startRecording()
    }
  }

  // stopRef is assigned synchronously in startRecording and cleared in
  // stopRecording / stopAndTranscribe / failRecording / onDestroy — no $effect for control flow.

  onDestroy(() => {
    transcriber?.abort()
    transcriber = null
    discardRecorder()
    releaseStream()
    recording = false
    transcribing = false
    stopRef = undefined
  })
</script>

<Button
  type="button"
  variant="ghost"
  size="icon"
  class="relative size-8 overflow-hidden text-ink-3 pointer-fine:hover:bg-transparent pointer-fine:hover:text-ink {className}"
  disabled={disabled || !micSupported || transcribing}
  onclick={toggleMic}
  aria-label={recording
    ? 'Stop recording and transcribe'
    : transcribing
      ? 'Transcribing'
      : 'Start voice input'}
  aria-pressed={recording}
>
  <span class="relative z-10 inline-flex items-center justify-center">
    {#if transcribing}
      <LoaderCircle class="size-4 shrink-0 animate-spin" strokeWidth={1.75} />
    {:else if recording}
      <!-- live level: bars scale with the smoothed mic level (transform only); reduced
           motion holds them at a static mid height. The square says what the bars
           cannot: this button is now the stop control. -->
      <span
        class="flex items-center gap-[5px] h-4"
        data-testid="voice-level-meter"
        role="meter"
        aria-label="Microphone level"
        aria-valuenow={pulseSize}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <Square
          class="size-[9px] shrink-0 fill-current"
          strokeWidth={0}
          aria-hidden="true"
          data-testid="voice-stop-glyph"
        />
        {#each LEVEL_BARS as weight, i (i)}
          <span
            class="block w-[2px] h-4 rounded-full bg-current origin-center transition-transform duration-75 ease-out [transform:scaleY(var(--lvl))] motion-reduce:transition-none motion-reduce:[transform:scaleY(0.5)]"
            style:--lvl={(0.2 + 0.8 * Math.min(1, level * weight)).toFixed(3)}
          ></span>
        {/each}
      </span>
    {:else}
      <Mic class="size-4 shrink-0" strokeWidth={1.75} />
    {/if}
  </span>
</Button>

