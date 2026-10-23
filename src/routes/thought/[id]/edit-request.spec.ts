import { describe, expect, it } from 'vitest'
import { replaceTextEditRequest, textChange, typeEditRequest } from './edit-request'

/**
 * The thought page saves through the existing edit endpoint (POST /api/capture/edit,
 * body { thoughtId, editRequest }) — a natural-language request the server applies
 * with an LLM. These helpers only compose that request; they decide no meaning.
 */
describe('textChange', () => {
  it('returns the new words when they differ from the stored ones', () => {
    expect(textChange('old words', '  new words ')).toBe('new words')
  })

  it('returns null when nothing changed or the field was emptied', () => {
    expect(textChange('same', ' same ')).toBeNull()
    expect(textChange('kept', '   ')).toBeNull()
    expect(textChange('kept', '')).toBeNull()
  })
})

describe('replaceTextEditRequest', () => {
  it('carries the new words verbatim and asks for an exact replacement', () => {
    const request = replaceTextEditRequest('Call the studio on Monday')
    expect(request).toContain('Call the studio on Monday')
    expect(request.toLowerCase()).toContain('replace')
    expect(request.toLowerCase()).toContain('exactly')
  })

  it('keeps newlines in the words', () => {
    expect(replaceTextEditRequest('one\ntwo')).toContain('one\ntwo')
  })
})

describe('typeEditRequest', () => {
  it('names the chosen type without touching the words', () => {
    const request = typeEditRequest('To-do')
    expect(request).toContain('To-do')
    expect(request.toLowerCase()).toContain('keep the words')
  })
})
