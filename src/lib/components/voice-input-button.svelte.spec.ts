import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page } from 'vitest/browser'
import { installVoiceDoubles } from '$lib/test/voice-doubles'
import VoiceInputButton from './voice-input-button.svelte'

describe('voice-input-button.svelte', () => {
  it('is the mic: one tap hands over to the caller, nothing else happens', async () => {
    const doubles = installVoiceDoubles()
    try {
      const onclick = vi.fn()
      render(VoiceInputButton, { onclick })
      await page.getByRole('button', { name: 'Start voice input' }).click()
      expect(onclick).toHaveBeenCalledTimes(1)
      expect(doubles.getUserMedia).not.toHaveBeenCalled()
    } finally {
      doubles.restore()
    }
  })

  it('is disabled while starting (the permission prompt is open) and shows it', async () => {
    const doubles = installVoiceDoubles()
    try {
      render(VoiceInputButton, { onclick: vi.fn(), starting: true })
      await expect.element(page.getByTestId('voice-mic')).toBeDisabled()
      await expect.element(page.getByTestId('voice-mic')).toHaveAttribute('aria-busy', 'true')
    } finally {
      doubles.restore()
    }
  })

  it('is disabled when asked to be', async () => {
    const doubles = installVoiceDoubles()
    try {
      render(VoiceInputButton, { onclick: vi.fn(), disabled: true })
      await expect.element(page.getByTestId('voice-mic')).toBeDisabled()
    } finally {
      doubles.restore()
    }
  })

  it('is disabled where the browser cannot record', async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
    try {
      render(VoiceInputButton, { onclick: vi.fn() })
      await expect.element(page.getByTestId('voice-mic')).toBeDisabled()
    } finally {
      if (original) Object.defineProperty(navigator, 'mediaDevices', original)
    }
  })
})
