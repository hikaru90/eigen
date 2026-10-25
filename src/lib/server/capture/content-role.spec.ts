import { describe, expect, it } from 'vitest'
import {
  CONTENT_ROLES,
  isContentRole,
  readCaptureSplitState,
  type CaptureSplitPlan,
} from './content-role'

const plan: CaptureSplitPlan = {
  role: 'mixed',
  rationale: 'personal line plus a pasted recipe',
  spans: ['Baking this for Mom.'],
  spanThoughtIds: ['t1'],
  note: null,
  attachedFileId: 'file-1',
}

describe('content roles', () => {
  it('are exactly personal, reference and mixed', () => {
    expect([...CONTENT_ROLES]).toEqual(['personal', 'reference', 'mixed'])
  })

  it.each(['personal', 'reference', 'mixed'])('accepts %s', (role) => {
    expect(isContentRole(role)).toBe(true)
  })

  it.each(['thought_only', 'split', 'Personal', '', 'both', null, undefined, 3])(
    'rejects %s',
    (value) => {
      expect(isContentRole(value)).toBe(false)
    },
  )
})

describe('readCaptureSplitState', () => {
  it('is undecided for a capture nothing has been applied to', () => {
    expect(readCaptureSplitState({ queueTier: 'pending_enrich' })).toEqual({ phase: 'undecided' })
  })

  it('knows a span child (metadata.splitFrom) — it is never decided or split again', () => {
    expect(readCaptureSplitState({ splitFrom: 'parent-1' })).toEqual({ phase: 'span_child' })
  })

  it('returns the persisted plan so a retried enrich resumes instead of re-deciding', () => {
    expect(readCaptureSplitState({ captureContentSplit: plan })).toEqual({
      phase: 'applied',
      plan,
    })
  })

  it('treats the pre-L1 marker (mode thought_only | split) as an already-applied legacy split', () => {
    for (const mode of ['thought_only', 'split']) {
      expect(
        readCaptureSplitState({
          captureContentSplit: { mode, rationale: 'r', attachedFileId: null },
        }),
      ).toEqual({ phase: 'legacy_applied', attachedFileId: null })
    }
  })

  it('keeps the note a legacy split attached', () => {
    expect(
      readCaptureSplitState({
        captureContentSplit: { mode: 'split', rationale: 'r', attachedFileId: 'file-old' },
      }),
    ).toEqual({ phase: 'legacy_applied', attachedFileId: 'file-old' })
  })

  it('fails loud on a marker with a role outside the three', () => {
    expect(() =>
      readCaptureSplitState({ captureContentSplit: { ...plan, role: 'both' } }),
    ).toThrow(/role/)
  })

  it('fails loud on a malformed plan', () => {
    expect(() =>
      readCaptureSplitState({ captureContentSplit: { ...plan, spans: 'nope' } }),
    ).toThrow(/spans/)
    expect(() =>
      readCaptureSplitState({ captureContentSplit: { ...plan, spanThoughtIds: ['t1', 3] } }),
    ).toThrow(/spanThoughtIds/)
    expect(() =>
      readCaptureSplitState({ captureContentSplit: { ...plan, attachedFileId: 4 } }),
    ).toThrow(/attachedFileId/)
  })
})
