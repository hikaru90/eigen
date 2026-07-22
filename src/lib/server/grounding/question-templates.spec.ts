import { describe, expect, it } from 'vitest'
import { buildGroundingQuestionFromTemplate } from '$lib/server/grounding/question-templates'

describe('buildGroundingQuestionFromTemplate', () => {
  it('builds standalone work question', () => {
    expect(buildGroundingQuestionFromTemplate({ templateId: 'work_where' })).toEqual({
      facetKey: 'work',
      question: 'Where do you work?',
    })
  })

  it('builds anchored work question', () => {
    expect(
      buildGroundingQuestionFromTemplate({ templateId: 'work_where', anchor: 'SPACE' }),
    ).toEqual({
      facetKey: 'work',
      question: 'You mention SPACE a lot — is that where you work?',
    })
  })

  it('builds self name disambiguation', () => {
    expect(
      buildGroundingQuestionFromTemplate({
        templateId: 'self_name_disambiguation',
        anchor: 'Alex',
      }),
    ).toEqual({
      facetKey: 'identity',
      question: 'When you write "Alex," do you mean yourself or someone else?',
    })
  })

  it('returns null when anchor required but missing', () => {
    expect(buildGroundingQuestionFromTemplate({ templateId: 'person_disambiguation' })).toBeNull()
  })
})
