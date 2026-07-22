import fs from 'node:fs'
import path from 'node:path'
import { expect, type Page } from '@playwright/test'

const VOICE_FIXTURE_PATH = path.join(import.meta.dirname, 'fixtures', 'release-voice.wav')

/** Short spoken clip: "Release smoke voice capture test" (generated via macOS `say`). */
export function readReleaseVoiceFixture(): Buffer {
  return fs.readFileSync(VOICE_FIXTURE_PATH)
}

/**
 * Replaces getUserMedia / MediaRecorder so the mic button records the release fixture
 * instead of a real microphone (stable in CI and headed runs).
 */
export async function installVoiceCaptureMocks(page: Page): Promise<void> {
  const audioBase64 = readReleaseVoiceFixture().toString('base64')
  await page.addInitScript(
    ({ audioBase64: b64, mimeType }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const fakeBlob = new Blob([bytes], { type: mimeType })

      class MockAudioContext {
        createMediaStreamSource() {
          return { connect: () => undefined, disconnect: () => undefined }
        }
        createAnalyser() {
          return {
            fftSize: 256,
            smoothingTimeConstant: 0.8,
            getByteTimeDomainData(samples: Uint8Array) {
              samples.fill(128)
            },
          }
        }
        resume() {
          return Promise.resolve()
        }
        close() {
          return Promise.resolve()
        }
      }

      window.AudioContext = MockAudioContext as typeof AudioContext

      class FakeMediaRecorder extends EventTarget {
        static isTypeSupported(mimeType?: string) {
          // Release fixture is WAV — do not claim webm/opus support or the UI
          // labels WAV bytes as webm and STT returns empty / errors.
          if (!mimeType) return true
          return mimeType.includes('wav') || mimeType.includes('wave')
        }

        mimeType: string
        state: RecordingState = 'inactive'
        ondataavailable: ((ev: BlobEvent) => void) | null = null
        onstop: (() => void) | null = null
        onerror: (() => void) | null = null

        constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
          super()
          this.mimeType = options?.mimeType || mimeType
        }

        start() {
          this.state = 'recording'
        }

        stop() {
          this.state = 'inactive'
          this.ondataavailable?.({ data: fakeBlob } as BlobEvent)
          this.onstop?.()
        }
      }

      navigator.mediaDevices.getUserMedia = async () =>
        ({
          getTracks: () => [{ stop: () => undefined }],
          getAudioTracks: () => [{ stop: () => undefined }],
        }) as MediaStream

      window.MediaRecorder = FakeMediaRecorder as typeof MediaRecorder
    },
    { audioBase64, mimeType: 'audio/wav' },
  )
}

/** Authenticated POST to `/api/capture/transcribe` using the release voice fixture. */
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
          multipart: {
            audio: {
              name: 'release-voice.wav',
              mimeType: 'audio/wav',
              buffer,
            },
            language: 'en',
          },
        })

        if (!res.ok()) {
          const bodyText = await res.text()
          const transient =
            res.status() === 429 ||
            res.status() === 502 ||
            res.status() === 503 ||
            (res.status() === 500 && /(?:\b429\b|502|503|rate limit)/i.test(bodyText))
          if (transient) {
            return ''
          }
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

/**
 * Mic button → fixture "recording" → transcript appended to `#thought`.
 * Call `installVoiceCaptureMocks` before navigating to `/capture`.
 */
export async function exerciseVoiceCaptureUi(
  page: Page,
  options?: { timeoutMs?: number },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 120_000
  await page.goto('/capture')
  await expect(
    page.getByRole('dialog', { name: /Your memory, not theirs\.|Just drop it in\./ }),
  ).toBeHidden({
    timeout: 15_000,
  })
  await expect(page.locator('#thought')).toBeVisible()

  const mic = page.getByLabel('Start voice input', { exact: true })
  await expect(mic).toBeEnabled({ timeout: 15_000 })

  const errorBanner = page.locator('p.text-destructive.text-sm').first()
  const stopMic = page.getByLabel('Stop recording and transcribe', { exact: true })

  await mic.click()
  await expect(stopMic).toBeVisible()
  // Let the mock recorder settle (startRecording is async through getUserMedia).
  await expect(stopMic).toHaveAttribute('aria-pressed', 'true')
  await stopMic.click()

  let lastValue: string | null = null
  await expect
    .poll(
      async () => {
        if (await errorBanner.isVisible().catch(() => false)) {
          const message = (await errorBanner.textContent())?.trim() ?? ''
          if (/(?:\b429\b|502|503|rate limit)/i.test(message)) {
            return null
          }
          throw new Error(message ? `Voice capture failed: ${message}` : 'Voice capture failed')
        }
        const value = await page.locator('#thought').inputValue()
        const trimmed = value.trim()
        lastValue = trimmed.length > 0 ? value : null
        return lastValue
      },
      { timeout: timeoutMs, intervals: [500, 1000, 2000] },
    )
    .not.toBeNull()

  expect(lastValue, 'voice capture left #thought empty').toMatch(/release|voice|smoke|capture|test/i)
}
