import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client'
import { stripMarkdownJsonFences } from '$lib/server/memory/llm-json-content'
import { loadRelevanceCheckInCandidates } from '$lib/server/grounding/relevance-candidates'
import {
  buildRelevanceQuestionFromTemplate,
  RELEVANCE_QUESTION_TEMPLATE_IDS,
  RELEVANCE_QUESTION_TEMPLATE_ID_SET,
  type RelevanceQuestionTemplateId,
} from '$lib/server/grounding/relevance-templates'

export type RelevanceCheckInQuestion = {
  kind: 'relevance'
  templateId: RelevanceQuestionTemplateId
  thoughtId: string
  snippet: string
  question: string
}

function parseRelevanceSelectionOutput(
  raw: string,
  allowedIds: Set<string>,
): {
  templateId: RelevanceQuestionTemplateId
  thoughtId: string
} | null {
  const trimmed = stripMarkdownJsonFences(raw.trim())
  const parsed = JSON.parse(trimmed) as unknown
  if (!parsed || typeof parsed !== 'object') return null
  const o = parsed as Record<string, unknown>
  if (o.skip === true) return null
  if (typeof o.question === 'string' && typeof o.templateId !== 'string') return null

  const templateId = typeof o.templateId === 'string' ? o.templateId.trim() : ''
  const thoughtId = typeof o.thoughtId === 'string' ? o.thoughtId.trim() : ''
  if (!RELEVANCE_QUESTION_TEMPLATE_ID_SET.has(templateId)) return null
  if (!allowedIds.has(thoughtId)) return null

  return {
    templateId: templateId as RelevanceQuestionTemplateId,
    thoughtId,
  }
}

function buildRelevanceSelectionPrompt(input: { candidateLines: string[] }): string {
  const templateGuide = RELEVANCE_QUESTION_TEMPLATE_IDS.map((id) => `- ${id}`).join('\n')

  return [
    'Return ONLY JSON with one of these shapes:',
    '{"templateId": "<id>", "thoughtId": "<uuid from candidates>"}',
    '{"skip": true}',
    '',
    'You pick at most one faded personal memory to ask about for a relevance check-in.',
    'Do NOT write custom question text. Pick a templateId and thoughtId from the lists, or skip.',
    '',
    'Approved templateIds:',
    templateGuide,
    '',
    'When to ask:',
    '- thought_still_relevant: a note that may no longer matter to the user.',
    '- thought_still_on_mind: something that might still be active, but has gone quiet.',
    '',
    'Rules:',
    '- Skip if nothing is worth asking — never ask just to fill a card.',
    '- Prefer clearly aged, low-salience, non-actionable notes over durable facts.',
    '- Never invent a thoughtId. Use exactly one id from the candidate list.',
    '- Prefer one concrete thought, not a generic life question.',
    '- If candidates are thin or all look still useful, return {"skip": true}.',
    '',
    'Candidates (id | inactiveDays | salience | category | excerpt):',
    input.candidateLines.join('\n'),
  ].join('\n')
}

export async function generateRelevanceQuestion(
  userId: string,
): Promise<RelevanceCheckInQuestion | null> {
  const candidates = await loadRelevanceCheckInCandidates(userId)
  if (candidates.length === 0) return null

  const allowedIds = new Set(candidates.map((c) => c.id))
  const candidateLines = candidates.map(
    (c) =>
      `${c.id} | ${c.inactiveDays}d | sal=${c.salienceScore.toFixed(2)} | [${c.category}] ${c.normalizedText.slice(0, 160)}`,
  )

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You select one approved relevance check-in template and one candidate thought. JSON only — never write free-form question text.',
    },
    {
      role: 'user',
      content: buildRelevanceSelectionPrompt({ candidateLines }),
    },
  ]

  const response = await llmChatCompletion({
    userId,
    messages,
    temperature: 0,
    logContext: 'relevance_checkin_next_question',
  })

  const content = (response as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]
    ?.message?.content
  if (typeof content !== 'string') {
    throw new Error('generateRelevanceQuestion: missing LLM content')
  }

  try {
    const selection = parseRelevanceSelectionOutput(content, allowedIds)
    if (!selection) return null
    const candidate = candidates.find((c) => c.id === selection.thoughtId)
    if (!candidate) return null
    const built = buildRelevanceQuestionFromTemplate({
      templateId: selection.templateId,
      snippet: candidate.normalizedText,
    })
    if (!built) return null
    return {
      kind: 'relevance',
      templateId: built.templateId,
      thoughtId: candidate.id,
      snippet: built.snippet,
      question: built.question,
    }
  } catch {
    return null
  }
}
