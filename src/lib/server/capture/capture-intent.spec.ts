import { describe, expect, it } from 'vitest'
import {
  CAPTURE_INTENTS,
  FORGET_INSTRUCTION_STATUSES,
  isCaptureIntent,
  readCaptureIntent,
  readForgetInstruction,
} from './capture-intent'

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

describe('forgetInstruction marker (S2b)', () => {
  it('has no marker until the forget request was applied once', () => {
    expect(readForgetInstruction({})).toBeUndefined()
    expect(readForgetInstruction({ forgetInstruction: null })).toBeUndefined()
  })

  it('returns the persisted status and unresolved hits', () => {
    const marker = {
      status: 'unresolved',
      unresolved: [{ kind: 'thought', id: 't1' }, { kind: 'note', id: 'n1' }],
    }
    expect(readForgetInstruction({ forgetInstruction: marker })).toEqual(marker)
    expect(readForgetInstruction({ forgetInstruction: { status: 'nothing_found', unresolved: [] } })).toEqual({
      status: 'nothing_found',
      unresolved: [],
    })
  })

  it('only the states that keep the instruction exist', () => {
    expect([...FORGET_INSTRUCTION_STATUSES]).toEqual([
      'nothing_found',
      'nothing_removed',
      'unresolved',
      'partial',
    ])
  })

  it('fails loudly on a malformed marker', () => {
    expect(() => readForgetInstruction({ forgetInstruction: 'kept' })).toThrow(/forgetInstruction/)
    expect(() => readForgetInstruction({ forgetInstruction: { status: 'applied', unresolved: [] } })).toThrow(/status/)
    expect(() => readForgetInstruction({ forgetInstruction: { status: 'partial' } })).toThrow(/unresolved/)
    expect(() =>
      readForgetInstruction({ forgetInstruction: { status: 'partial', unresolved: [{ kind: 'event', id: 'x' }] } }),
    ).toThrow(/unresolved/)
    expect(() =>
      readForgetInstruction({ forgetInstruction: { status: 'partial', unresolved: [{ kind: 'note', id: '' }] } }),
    ).toThrow(/unresolved/)
  })
})
