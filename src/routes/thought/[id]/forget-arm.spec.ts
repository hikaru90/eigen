import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createForgetArm, FORGET_ARM_MS } from './forget-arm.svelte'

/**
 * Forget, with an arm step (ei app.js:1473-1483): the first tap arms the control
 * ("Forget for good?") for ~3 s, a second tap inside that window confirms. The arm
 * drops on its own when the window passes — nothing is forgotten by one accidental tap.
 */
describe('createForgetArm', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts disarmed and arms on the first tap', () => {
    const arm = createForgetArm()
    expect(arm.armed).toBe(false)
    expect(arm.tap()).toBe('armed')
    expect(arm.armed).toBe(true)
    arm.dispose()
  })

  it('confirms on a second tap inside the window and disarms', () => {
    const arm = createForgetArm()
    arm.tap()
    vi.advanceTimersByTime(1000)
    expect(arm.tap()).toBe('confirmed')
    expect(arm.armed).toBe(false)
    arm.dispose()
  })

  it('drops the arm when the window passes (ei: 3.2 s)', () => {
    const arm = createForgetArm()
    arm.tap()
    vi.advanceTimersByTime(FORGET_ARM_MS - 1)
    expect(arm.armed).toBe(true)
    vi.advanceTimersByTime(1)
    expect(arm.armed).toBe(false)
    // a tap after the window arms again — it never confirms by surprise
    expect(arm.tap()).toBe('armed')
    arm.dispose()
  })

  it('honours a custom window', () => {
    const arm = createForgetArm({ armMs: 500 })
    arm.tap()
    vi.advanceTimersByTime(499)
    expect(arm.armed).toBe(true)
    vi.advanceTimersByTime(1)
    expect(arm.armed).toBe(false)
    arm.dispose()
  })

  it('disarm() clears the arm and its timer; dispose() leaves nothing pending', () => {
    const arm = createForgetArm()
    arm.tap()
    arm.disarm()
    expect(arm.armed).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    arm.tap()
    arm.dispose()
    expect(arm.armed).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})
