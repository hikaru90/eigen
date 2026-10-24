/**
 * A check-in question (GET /api/grounding/question): a grounding question about the
 * user ("Where do you work?") or a relevance check on an older memory/project
 * ("Is X still a project you're working on?"). Shown in Notifications.
 */
export type CheckInQuestion =
  | { kind: 'grounding'; facetKey: string; question: string }
  | { kind: 'relevance'; thoughtId: string; snippet: string; question: string }

/** The endpoint's `question` field, validated into a CheckInQuestion (null when there is none). */
export function parseCheckInQuestion(raw: unknown): CheckInQuestion | null {
  if (!raw || typeof raw !== 'object') return null
  const q = raw as Record<string, unknown>
  const question = typeof q.question === 'string' ? q.question.trim() : ''
  if (!question) return null
  if (q.kind === 'relevance' && typeof q.thoughtId === 'string' && typeof q.snippet === 'string') {
    return { kind: 'relevance', thoughtId: q.thoughtId, snippet: q.snippet, question }
  }
  if (typeof q.facetKey === 'string' && q.facetKey) {
    return { kind: 'grounding', facetKey: q.facetKey, question }
  }
  return null
}
