import { describe, expect, it } from 'vitest'
import { modelSlug } from './model-slug'

describe('modelSlug', () => {
  it('keeps the part after the last slash', () => {
    expect(modelSlug('openai/gpt-4o-mini')).toBe('gpt-4o-mini')
    expect(modelSlug('deepseek/deepseek-v4.1-flash-1017')).toBe('deepseek-v4.1-flash-1017')
  })

  it('lowercases and keeps only [a-z0-9.-]', () => {
    expect(modelSlug('Vendor/Model_Name:Free+X')).toBe('modelnamefreex')
  })

  it('throws when nothing is left', () => {
    expect(() => modelSlug('vendor/___')).toThrow(/slug/)
    expect(() => modelSlug('')).toThrow(/slug/)
    expect(() => modelSlug('vendor/')).toThrow(/slug/)
  })
})
