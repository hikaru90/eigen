import { describe, expect, it } from 'vitest'
import { buildCaptureFidelityJudgeInput } from './capture-eval-fidelity-input'

describe('buildCaptureFidelityJudgeInput', () => {
  it('uses submitted rawText even when stored capture result omits rawText', () => {
    const submitted = 'Marcus is allergic to walnuts.'
    const stored = {
      normalizedText: submitted,
      category: 'task',
    }

    expect(buildCaptureFidelityJudgeInput(submitted, stored)).toEqual({
      rawText: submitted,
      normalizedText: submitted,
      category: 'task',
    })
    expect((stored as Record<string, unknown>).rawText).toBeUndefined()
  })
})
