import { describe, expect, it } from 'vitest'
import { askDraftFor, askHrefFor, excerptWords } from './ask-handoff'

/**
 * "Ask what connects to this" (ei app.js:1472): the thought's first words become the
 * question's quote; the thought id rides along to /chat as a query param so Ask can
 * ground the question once it reads it.
 */
describe('excerptWords', () => {
  it('keeps the first six words and marks the cut', () => {
    expect(excerptWords('one two three four five six seven eight')).toBe('one two three four five six…')
  })

  it('leaves short thoughts whole', () => {
    expect(excerptWords('just a few words')).toBe('just a few words')
  })

  it('collapses whitespace and newlines', () => {
    expect(excerptWords('  one \n two   three  ')).toBe('one two three')
  })
})

describe('askDraftFor', () => {
  it('quotes the excerpt in the writer', () => {
    expect(askDraftFor('one two three four five six seven')).toBe('“one two three four five six…”')
  })
})

describe('askHrefFor', () => {
  it('carries the thought id to Ask', () => {
    expect(askHrefFor('t 1/x')).toBe('/chat?thought=t%201%2Fx')
  })
})
