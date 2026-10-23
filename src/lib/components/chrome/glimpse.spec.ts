import { describe, expect, it } from 'vitest'
import { GLIMPSE_HOLD_MS, GLIMPSE_INTERVAL_MS, isWritingIntoField, shouldGlimpse } from './glimpse'

const clear = {
  onEntryPage: false,
  tabHidden: false,
  reducedMotion: false,
}

describe('glimpse guards (ported from the ei prototype)', () => {
  it('keeps the ei timing: every 30 s, held for 2.8 s', () => {
    expect(GLIMPSE_INTERVAL_MS).toBe(30_000)
    expect(GLIMPSE_HOLD_MS).toBe(2_800)
  })

  it('runs when nothing blocks it', () => {
    expect(shouldGlimpse(clear)).toBe(true)
  })

  it('never runs while already on the Make me better page', () => {
    expect(shouldGlimpse({ ...clear, onEntryPage: true })).toBe(false)
  })

  it('never runs while the tab is hidden', () => {
    expect(shouldGlimpse({ ...clear, tabHidden: true })).toBe(false)
  })

  it('never runs when reduced motion is asked for', () => {
    expect(shouldGlimpse({ ...clear, reducedMotion: true })).toBe(false)
  })

  it('never runs while the user is typing words into a field', () => {
    const typing = { tagName: 'TEXTAREA', value: 'What’s on my mind' }
    expect(shouldGlimpse(clear, typing)).toBe(false)
  })

  it('an empty focused field is not writing — the glimpse still runs', () => {
    // ei app.js: writing means a field with a non-empty value, focus alone does not block.
    expect(shouldGlimpse(clear, { tagName: 'TEXTAREA', value: '' })).toBe(true)
    expect(shouldGlimpse(clear, { tagName: 'INPUT', value: '   ' })).toBe(true)
  })
})

describe('isWritingIntoField', () => {
  it('counts textareas and inputs with words in them', () => {
    expect(isWritingIntoField({ tagName: 'TEXTAREA', value: 'hello' })).toBe(true)
    expect(isWritingIntoField({ tagName: 'INPUT', value: 'hello' })).toBe(true)
  })

  it('counts contenteditable elements with words in them', () => {
    expect(isWritingIntoField({ tagName: 'DIV', isContentEditable: true, value: '' })).toBe(false)
    expect(isWritingIntoField({ tagName: 'DIV', isContentEditable: true, value: 'prose' })).toBe(true)
  })

  it('ignores non-fields and missing elements', () => {
    expect(isWritingIntoField({ tagName: 'BUTTON', value: 'Sign out' })).toBe(false)
    expect(isWritingIntoField(null)).toBe(false)
    expect(isWritingIntoField(undefined)).toBe(false)
  })
})
