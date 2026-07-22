import { describe, expect, it } from 'vitest'
import { buildRelevanceQuestionFromTemplate } from '$lib/server/grounding/relevance-templates'

describe('buildRelevanceQuestionFromTemplate', () => {
  it('builds thought_still_relevant with clipped snippet', () => {
    const result = buildRelevanceQuestionFromTemplate({
      templateId: 'thought_still_relevant',
      snippet: '  Notes about the workshop next spring  ',
    })
    expect(result).toEqual({
      templateId: 'thought_still_relevant',
      snippet: 'Notes about the workshop next spring',
      question:
        'This from a while ago — still relevant for you?\n\n“Notes about the workshop next spring”',
    })
  })

  it('requires a non-empty snippet', () => {
    expect(
      buildRelevanceQuestionFromTemplate({
        templateId: 'thought_still_on_mind',
        snippet: '   ',
      }),
    ).toBeNull()
  })

  it('clips long snippets', () => {
    const long = 'x'.repeat(200)
    const result = buildRelevanceQuestionFromTemplate({
      templateId: 'thought_still_on_mind',
      snippet: long,
    })
    expect(result?.snippet.length).toBe(120)
    expect(result?.snippet.endsWith('…')).toBe(true)
    expect(result?.question).toContain('Is this still on your mind')
  })
})
