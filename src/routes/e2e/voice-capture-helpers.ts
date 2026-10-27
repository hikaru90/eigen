import fs from 'node:fs'
import path from 'node:path'
import { expect, type Locator, type Page } from '@playwright/test'

const VOICE_FIXTURE_PATH = path.join(import.meta.dirname, 'fixtures', 'release-voice.wav')

/** Short spoken clip: "Release smoke voice capture test" (generated via macOS `say`). */
export function readReleaseVoiceFixture(): Buffer {
  return fs.readFileSync(VOICE_FIXTURE_PATH)
}

/** What the mocked transcribe endpoint answers for a good clip. */
export const VOICE_TRANSCRIPT = 'Release smoke voice capture test'

/**
 * Replaces getUserMedia / MediaRecorder / AudioContext so the mic button records the
 * release fixture instead of a real microphone (stable in CI and headed runs). One
 * recorder is one clip: on `stop()` it hands over the whole fixture as a single WAV
 * `dataavailable`, then `stop`. The analyser reports a moving signal, so the waveform
 * visibly animates. `window.__voiceMock` counts what the page did, for assertions.
 */
export async function installVoiceMocks(page: Page): Promise<void> {
  const audioBase64 = readReleaseVoiceFixture().toString('base64')
  await page.addInitScript(
    ({ audioBase64: b64, mimeType }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const fakeBlob = new Blob([bytes], { type: mimeType })
      const counters = { recorders: 0, timeslices: [] as Array<number | null>, tracksStopped: 0 }
      ;(window as unknown as { __voiceMock: typeof counters }).__voiceMock = counters

      class MockAudioContext {
        state = 'suspended'
        createMediaStreamSource() {
          return { connect: () => undefined, disconnect: () => undefined }
        }
        createAnalyser() {
          return {
            fftSize: 256,
            smoothingTimeConstant: 0.8,
            getByteTimeDomainData(samples: Uint8Array) {
              // a swell that moves with the clock: the bars visibly rise and fall
              const amplitude = 4 + 14 * Math.abs(Math.sin(performance.now() / 400))
              for (let i = 0; i < samples.length; i++) {
                samples[i] = 128 + (i % 2 ? amplitude : -amplitude)
              }
            },
          }
        }
        resume() {
          this.state = 'running'
          return Promise.resolve()
        }
        close() {
          return Promise.resolve()
        }
      }
      window.AudioContext = MockAudioContext as unknown as typeof AudioContext

      class FakeMediaRecorder extends EventTarget {
        // The release fixture is WAV: claim no webm/mp4 support so the page records with
        // the recorder default, and the clip is labelled with what its bytes are.
        static isTypeSupported() {
          return false
        }

        mimeType: string
        state: RecordingState = 'inactive'
        ondataavailable: ((ev: BlobEvent) => void) | null = null
        onstop: (() => void) | null = null
        onerror: (() => void) | null = null

        constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
          super()
          this.mimeType = options?.mimeType || mimeType
          counters.recorders += 1
        }

        start(timeslice?: number) {
          this.state = 'recording'
          counters.timeslices.push(timeslice ?? null)
        }

        stop() {
          if (this.state === 'inactive') return
          this.state = 'inactive'
          setTimeout(() => {
            this.ondataavailable?.({ data: fakeBlob } as BlobEvent)
            this.onstop?.()
          }, 0)
        }
      }
      window.MediaRecorder = FakeMediaRecorder as unknown as typeof MediaRecorder

      navigator.mediaDevices.getUserMedia = async () => {
        const track = { stop: () => (counters.tracksStopped += 1) }
        return {
          getTracks: () => [track],
          getAudioTracks: () => [track],
        } as unknown as MediaStream
      }
    },
    { audioBase64, mimeType: 'audio/wav' },
  )
}

export type TranscribeMock = {
  /** Every request body the endpoint received (the whole clip each time). */
  bodies: Buffer[]
  contentTypes: string[]
  /** The next request fails with this status and message; later ones succeed again. */
  failNext(status: number, error: string): void
}

/** Answers `POST /api/capture/transcribe` without calling the provider. */
export async function mockTranscribeEndpoint(
  page: Page,
  transcript = VOICE_TRANSCRIPT,
): Promise<TranscribeMock> {
  const failures: Array<{ status: number; error: string }> = []
  const mock: TranscribeMock = {
    bodies: [],
    contentTypes: [],
    failNext(status, error) {
      failures.push({ status, error })
    },
  }
  await page.route('**/api/capture/transcribe', async (route) => {
    const request = route.request()
    const body = request.postDataBuffer()
    if (body) mock.bodies.push(body)
    mock.contentTypes.push(request.headers()['content-type'] ?? '')
    const failure = failures.shift()
    if (failure) {
      await route.fulfill({
        status: failure.status,
        contentType: 'application/json',
        body: JSON.stringify({ error: failure.error }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ transcript }),
    })
  })
  return mock
}

/**
 * Keeps Capture off the model: the live read (`/api/capture/read`, an LLM call while typing)
 * is refused, and a submit is answered with an error instead of storing and enriching a
 * thought. The specs only look at what the page sends, never at what the server does with it.
 */
export async function mockCaptureWithoutLlm(page: Page): Promise<void> {
  await page.route('**/api/capture/read', (route) => route.abort('failed'))
  await page.route(/\/api\/capture\/(submit|keep)$/, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'not under test' }),
    }),
  )
}

/** Authenticated POST of the release fixture to the real `/api/capture/transcribe` (live provider). */
export async function assertVoiceTranscribeApi(
  page: Page,
  options?: { timeoutMs?: number },
): Promise<string> {
  const timeoutMs = options?.timeoutMs ?? 180_000
  const buffer = readReleaseVoiceFixture()
  let transcript = ''

  await expect
    .poll(
      async () => {
        const res = await page.request.post('/api/capture/transcribe', {
          headers: { 'content-type': 'audio/wav' },
          data: buffer,
        })

        if (!res.ok()) {
          const bodyText = await res.text()
          // the server already tried the provider 3 times; only provider-side noise retries here
          const transient = res.status() === 429 || res.status() === 502 || res.status() === 503
          if (transient) return ''
          throw new Error(`transcribe API failed (${res.status()}): ${bodyText}`)
        }

        const body = (await res.json()) as { transcript?: string }
        const text = body.transcript?.trim() ?? ''
        if (!text) {
          throw new Error('transcribe API returned empty transcript')
        }
        transcript = text
        return text
      },
      { timeout: timeoutMs, intervals: [2_000, 5_000, 10_000] },
    )
    .toMatch(/release|voice|smoke|capture|test/i)

  return transcript
}

function voiceMockCounters(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __voiceMock: { recorders: number; timeslices: Array<number | null>; tracksStopped: number }
        }
      ).__voiceMock,
  )
}

/**
 * Taps the mic and waits for the voice bar: a moving waveform and a running timer
 * replace the field, and no transcribe request has been made yet.
 */
export async function startVoiceMessage(page: Page, transcribe: TranscribeMock): Promise<Locator> {
  const mic = page.getByTestId('voice-mic')
  await expect(mic).toBeEnabled({ timeout: 15_000 })
  const requestsBefore = transcribe.bodies.length
  await mic.click()
  const bar = page.getByTestId('voice-bar')
  await expect(bar).toBeVisible()

  // the waveform moves: the newest bar changes height while the mic swells
  const newestBar = page.getByTestId('voice-waveform').locator(':scope > *').last()
  const seen = new Set<string>()
  await expect
    .poll(
      async () => {
        seen.add((await newestBar.evaluate((el) => (el as HTMLElement).style.getPropertyValue('--lvl'))) ?? '')
        return seen.size
      },
      { timeout: 10_000, intervals: [150] },
    )
    .toBeGreaterThan(2)
  // the timer runs
  await expect(page.getByTestId('voice-timer')).toContainText(/0:0[1-9]/, { timeout: 10_000 })

  expect(transcribe.bodies.length, 'no request while recording').toBe(requestsBefore)
  const counters = await voiceMockCounters(page)
  expect(counters.timeslices.at(-1), 'one recorder, 1000 ms timeslice').toBe(1000)
  return bar
}

/** After Send: exactly one request carried the whole fixture clip. */
export function expectWholeClipUploaded(transcribe: TranscribeMock, uploads: number): void {
  expect(transcribe.bodies, 'one upload per send/retry').toHaveLength(uploads)
  const fixture = readReleaseVoiceFixture()
  for (const body of transcribe.bodies) {
    expect(body.subarray(0, 4).toString('latin1'), 'the clip is a standalone WAV').toBe('RIFF')
    expect(body.equals(fixture), 'the whole clip, not a piece').toBe(true)
  }
  for (const type of transcribe.contentTypes) expect(type).toBe('audio/wav')
}

export async function expectNoMicrophoneHeld(page: Page): Promise<void> {
  await expect
    .poll(async () => (await voiceMockCounters(page)).tracksStopped, { timeout: 10_000 })
    .toBeGreaterThan(0)
}
