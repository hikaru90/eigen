import type { ReadingDraft } from './reading-state'
import { describe, expect, it } from 'vitest'
import { planCaptureSubmit } from './submit-plan'

const RAW = 'Call the studio about the frame order'

const reading = {
  interpretedText: 'Call the studio about the frame order.',
  category: { key: 'task', confidence: 0.9, alternatives: [] },
  entities: [],
  deviatesFromVerbatim: true,
}

const draft = (over: Partial<ReadingDraft> = {}): ReadingDraft => ({
  rawText: RAW,
  reading,
  ...over,
})

describe('planCaptureSubmit (one-call submit decision, ei decision #3: read → keep)', () => {
  it('keeps the fresh reading in one call, carrying the accepted bundle', () => {
    expect(planCaptureSubmit({ raw: RAW, draft: draft() })).toEqual({ kind: 'keep', reading })
    expect(planCaptureSubmit({ raw: `  ${RAW}  `, draft: draft() })).toEqual({
      kind: 'keep',
      reading,
    })
  })

  it('carries a user-edited type into keep (the accepted copy is what gets stored)', () => {
    const edited = { ...reading, category: { ...reading.category, key: 'question' } }
    expect(planCaptureSubmit({ raw: RAW, draft: draft({ reading: edited }) })).toEqual({
      kind: 'keep',
      reading: edited,
    })
  })

  it('a stale reading (user kept typing) must never be kept — enqueue raw instead', () => {
    // Verbatim invariant: raw_text must be the typed words; a stale draft's reading
    // was read from an older text, so keeping it would store words the user changed.
    expect(planCaptureSubmit({ raw: `${RAW} today`, draft: draft() })).toEqual({ kind: 'enqueue' })
  })

  it('no reading (read failed / still waiting) enqueues the raw text', () => {
    expect(planCaptureSubmit({ raw: RAW, draft: null })).toEqual({ kind: 'enqueue' })
    expect(planCaptureSubmit({ raw: RAW, draft: draft({ rawText: 'an older sentence' }) })).toEqual({
      kind: 'enqueue',
    })
  })

  it('offline always takes the queue (Background Sync), even with a fresh reading', () => {
    expect(planCaptureSubmit({ raw: RAW, draft: draft(), offline: true })).toEqual({
      kind: 'enqueue',
    })
  })

  it('empty or blocked captures submit nothing', () => {
    expect(planCaptureSubmit({ raw: '   ', draft: draft() })).toEqual({ kind: 'none' })
    expect(planCaptureSubmit({ raw: '', draft: null })).toEqual({ kind: 'none' })
    expect(planCaptureSubmit({ raw: RAW, draft: draft(), blocked: true })).toEqual({ kind: 'none' })
  })
})
