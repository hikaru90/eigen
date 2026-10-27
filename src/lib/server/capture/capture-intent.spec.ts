import { describe, expect, it } from 'vitest'
import { CAPTURE_INTENTS, isCaptureIntent, readCaptureIntent } from './capture-intent'

describe('capture intent vocabulary', () => {
  it('is exactly store | forget', () => {
    expect([...CAPTURE_INTENTS]).toEqual(['store', 'forget'])
  })

  it('isCaptureIntent accepts only the two keys', () => {
    expect(isCaptureIntent('store')).toBe(true)
    expect(isCaptureIntent('forget')).toBe(true)
    expect(isCaptureIntent('delete')).toBe(false)
    expect(isCaptureIntent(undefined)).toBe(false)
    expect(isCaptureIntent(1)).toBe(false)
  })
})

describe('readCaptureIntent', () => {
  it('is undecided (undefined) when the capture has no marker', () => {
    expect(readCaptureIntent({})).toBeUndefined()
  })

  it('returns the persisted intent', () => {
    expect(readCaptureIntent({ captureIntent: 'forget' })).toBe('forget')
    expect(readCaptureIntent({ captureIntent: 'store' })).toBe('store')
  })

  it('fails loudly on a marker outside the vocabulary', () => {
    expect(() => readCaptureIntent({ captureIntent: 'erase' })).toThrow(/captureIntent/)
    expect(() => readCaptureIntent({ captureIntent: 3 })).toThrow(/captureIntent/)
  })
})
