import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page } from 'vitest/browser'
import {
  VOICE_MESSAGE_MAX_MS,
  WAVEFORM_BARS,
  type VoiceFailure,
  type VoiceMessageView,
} from '$lib/capture/voice-message'
import VoiceMessageBar from './voice-message-bar.svelte'

const rising = Array.from({ length: WAVEFORM_BARS }, (_, i) => i / (WAVEFORM_BARS - 1))

function view(overrides: Partial<VoiceMessageView>): VoiceMessageView {
  return { phase: 'recording', elapsedMs: 0, levels: rising, failure: null, ...overrides }
}

function failed(failure: VoiceFailure, elapsedMs = 12_000): VoiceMessageView {
  return view({ phase: 'failed', elapsedMs, failure })
}

function renderBar(v: VoiceMessageView) {
  const handlers = { onsend: vi.fn(), ondiscard: vi.fn(), onretry: vi.fn() }
  render(VoiceMessageBar, { view: v, ...handlers })
  return handlers
}

describe('voice-message-bar.svelte', () => {
  describe('recording', () => {
    it('shows the waveform and the running timer next to the 5:00 cap', async () => {
      renderBar(view({ elapsedMs: 7_400 }))
      await expect.element(page.getByTestId('voice-bar')).toBeInTheDocument()
      await expect.element(page.getByTestId('voice-timer')).toHaveTextContent('0:07 / 5:00')
      expect(VOICE_MESSAGE_MAX_MS).toBe(300_000)
      const bars = (page.getByTestId('voice-waveform').element() as HTMLElement).children
      expect(bars).toHaveLength(WAVEFORM_BARS)
    })

    it('draws each bar from its mic level: the newest on the right', async () => {
      renderBar(view({}))
      const bars = [...(page.getByTestId('voice-waveform').element() as HTMLElement).children]
      const lvl = (el: Element) => Number.parseFloat((el as HTMLElement).style.getPropertyValue('--lvl'))
      expect(lvl(bars[0]!)).toBeLessThan(lvl(bars.at(-1)!))
      // quiet is still a visible line, never a gap
      expect(lvl(bars[0]!)).toBeGreaterThan(0)
      expect(lvl(bars.at(-1)!)).toBeLessThanOrEqual(1)
    })

    it('has a discard and a send button, each acting once', async () => {
      const { onsend, ondiscard, onretry } = renderBar(view({}))
      await page.getByTestId('voice-send').click()
      expect(onsend).toHaveBeenCalledTimes(1)
      await page.getByTestId('voice-discard').click()
      expect(ondiscard).toHaveBeenCalledTimes(1)
      expect(onretry).not.toHaveBeenCalled()
      await expect.element(page.getByTestId('voice-retry')).not.toBeInTheDocument()
    })

    it('names its controls for assistive tech', async () => {
      renderBar(view({}))
      await expect.element(page.getByRole('button', { name: 'Send voice message' })).toBeInTheDocument()
      await expect.element(page.getByRole('button', { name: 'Discard recording' })).toBeInTheDocument()
    })
  })

  describe('transcribing', () => {
    it('says it is transcribing over the frozen waveform and offers no controls', async () => {
      renderBar(view({ phase: 'transcribing', elapsedMs: 31_000 }))
      await expect.element(page.getByTestId('voice-status')).toHaveTextContent('Transcribing…')
      await expect.element(page.getByTestId('voice-waveform')).toBeInTheDocument()
      await expect.element(page.getByTestId('voice-send')).not.toBeInTheDocument()
      await expect.element(page.getByTestId('voice-discard')).not.toBeInTheDocument()
      await expect.element(page.getByTestId('voice-retry')).not.toBeInTheDocument()
    })

    it('announces itself politely', async () => {
      renderBar(view({ phase: 'transcribing' }))
      await expect.element(page.getByRole('status')).toHaveTextContent('Transcribing…')
    })
  })

  describe('failed', () => {
    it('shows a plain error with Retry and Discard when the clip is kept', async () => {
      const { onretry, ondiscard } = renderBar(
        failed({ reason: 'request', status: 502, detail: 'Transcription failed', retryable: true }),
      )
      await expect
        .element(page.getByTestId('voice-error'))
        .toHaveTextContent("Couldn't transcribe the recording")
      await page.getByTestId('voice-retry').click()
      expect(onretry).toHaveBeenCalledTimes(1)
      await page.getByTestId('voice-discard').click()
      expect(ondiscard).toHaveBeenCalledTimes(1)
      await expect.element(page.getByTestId('voice-send')).not.toBeInTheDocument()
    })

    it('shows the billing message of a 402 as the server wrote it', async () => {
      renderBar(
        failed({ reason: 'request', status: 402, detail: 'Insufficient credits', retryable: true }),
      )
      await expect.element(page.getByTestId('voice-error')).toHaveTextContent('Insufficient credits')
    })

    it('names the limit of a rejected upload as the server wrote it', async () => {
      renderBar(
        failed({
          reason: 'request',
          status: 400,
          detail: 'audio clip exceeds 8388608 bytes (max 5 minutes)',
          retryable: true,
        }),
      )
      await expect.element(page.getByTestId('voice-error')).toHaveTextContent('8388608 bytes')
    })

    it('says "No speech detected" for an empty transcript, with Retry and Discard', async () => {
      renderBar(failed({ reason: 'empty', retryable: true }))
      await expect.element(page.getByTestId('voice-error')).toHaveTextContent('No speech detected')
      await expect.element(page.getByTestId('voice-retry')).toBeInTheDocument()
      await expect.element(page.getByTestId('voice-discard')).toBeInTheDocument()
    })

    it('has only Dismiss when there is no clip to retry (denied microphone)', async () => {
      const { ondiscard } = renderBar(failed({ reason: 'permission', retryable: false }))
      await expect
        .element(page.getByTestId('voice-error'))
        .toHaveTextContent('Microphone permission denied')
      await expect.element(page.getByTestId('voice-retry')).not.toBeInTheDocument()
      await page.getByRole('button', { name: 'Dismiss' }).click()
      expect(ondiscard).toHaveBeenCalledTimes(1)
    })

    it('reads as an alert', async () => {
      renderBar(failed({ reason: 'recorder', retryable: false }))
      await expect.element(page.getByRole('alert')).toHaveTextContent('Recording failed')
    })
  })
})
