import { describe, expect, it } from 'vitest'
import {
  INTERPRET_PENDING_STATUS_LABEL,
  INTERPRET_PENDING_STEP_DESCRIPTION,
  INTERPRET_PENDING_STEP_TITLE,
  interpretPendingView,
} from './interpret-pending'

describe('interpretPendingView', () => {
  it('returns status copy and a collapsed preview of the submitted thought', () => {
    const view = interpretPendingView('  Hamburg workshop   notes  ')
    expect(view.preview).toBe('Hamburg workshop notes')
    expect(view.statusLabel).toBe(INTERPRET_PENDING_STATUS_LABEL)
    expect(view.stepTitle).toBe(INTERPRET_PENDING_STEP_TITLE)
    expect(view.stepDescription).toBe(INTERPRET_PENDING_STEP_DESCRIPTION)
  })

  it('truncates long thoughts the same way queued capture rows do', () => {
    const raw = 'x'.repeat(80)
    expect(interpretPendingView(raw).preview).toBe(`${'x'.repeat(71)}…`)
  })
})
