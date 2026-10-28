import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page } from 'vitest/browser'
import { hapticPress, installButtonHaptics } from '$lib/haptics'
import Button from './button.svelte'

describe('Button primitive haptics', () => {
  let stop: (() => void) | undefined
  afterEach(() => {
    stop?.()
    vi.restoreAllMocks()
  })

  function spyVibrate() {
    const spy = vi.fn(() => true)
    Object.defineProperty(navigator, 'vibrate', { value: spy, configurable: true })
    return spy
  }

  it('a click on the Button pulses once', async () => {
    const spy = spyVibrate()
    stop = installButtonHaptics()
    render(Button, { children: undefined, 'aria-label': 'Go' })
    await page.getByRole('button', { name: 'Go' }).click()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('does not double-fire when the handler already pulsed', async () => {
    const spy = spyVibrate()
    stop = installButtonHaptics()
    render(Button, { 'aria-label': 'Go', onclick: () => hapticPress() })
    await page.getByRole('button', { name: 'Go' }).click()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('a disabled Button does not pulse', async () => {
    const spy = spyVibrate()
    stop = installButtonHaptics()
    render(Button, { 'aria-label': 'Go', disabled: true })
    await page.getByRole('button', { name: 'Go' }).click({ force: true })
    expect(spy).not.toHaveBeenCalled()
  })
})
