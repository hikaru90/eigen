import {
  generateGroundingQuestion,
  type GroundingQuestion,
} from '$lib/server/grounding/next-question'
import {
  generateRelevanceQuestion,
  type RelevanceCheckInQuestion,
} from '$lib/server/grounding/next-relevance-question'

export type GroundingCheckInQuestion = GroundingQuestion & { kind: 'grounding' }

export type CheckInQuestion = GroundingCheckInQuestion | RelevanceCheckInQuestion

/**
 * One check-in slot: prefer a grounding blank when the LLM finds one;
 * otherwise offer a relevance question about a faded non-task thought.
 */
export async function generateCheckInQuestion(userId: string): Promise<CheckInQuestion | null> {
  const grounding = await generateGroundingQuestion(userId)
  if (grounding) {
    return { kind: 'grounding', ...grounding }
  }

  return generateRelevanceQuestion(userId)
}
