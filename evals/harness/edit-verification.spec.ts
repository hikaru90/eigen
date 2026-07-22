import { describe, expect, it } from 'vitest'
import { editVerificationAnchors, storedTextReflectsEdit } from './edit-verification'

describe('editVerificationAnchors', () => {
  it('skips correction preambles and keeps substantive tokens', () => {
    const anchors = editVerificationAnchors(
      'Correction: Marcus is allergic to pecans, not walnuts. Do not bring pecan bread to dinner.',
    )
    expect(anchors).not.toContain('correction')
    expect(anchors).toContain('pecans')
    expect(anchors).toContain('marcus')
  })
})

describe('storedTextReflectsEdit', () => {
  it('passes when normalized text includes a substantive anchor, not the preamble', () => {
    expect(
      storedTextReflectsEdit(
        "Marcus is allergic to pecans. Don't bring the pecan bread to next dinner.",
        'Correction: Marcus is allergic to pecans, not walnuts. Do not bring pecan bread to dinner.',
      ),
    ).toBe(true)
  })

  it('fails when stored text omits all substantive anchors', () => {
    expect(
      storedTextReflectsEdit(
        'Unrelated note about bread flour.',
        'Correction: Marcus is allergic to pecans, not walnuts.',
      ),
    ).toBe(false)
  })
})
