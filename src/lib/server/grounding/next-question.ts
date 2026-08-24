import { loadGroundingProfileRow } from '$lib/server/grounding/profile'
import { loadRecentThoughtsForGroundingQuestion } from '$lib/server/grounding/question-due'
import {
  buildGroundingQuestionFromTemplate,
  GROUNDING_QUESTION_TEMPLATE_IDS,
  GROUNDING_QUESTION_TEMPLATE_ID_SET,
  type GroundingQuestionTemplateId,
} from '$lib/server/grounding/question-templates'
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client'
import { stripMarkdownJsonFences } from '$lib/server/memory/llm-json-content'

export type GroundingQuestion = {
  facetKey: import('$lib/server/grounding/constants').GroundingFacetKey
  question: string
}

function parseTemplateSelectionOutput(raw: string): {
  templateId: GroundingQuestionTemplateId
  anchor?: string
} | null {
  const trimmed = stripMarkdownJsonFences(raw.trim())
  const parsed = JSON.parse(trimmed) as unknown
  if (!parsed || typeof parsed !== 'object') return null
  const o = parsed as Record<string, unknown>
  if (o.skip === true) return null
  // Legacy free-form LLM shape — never pass custom question text through.
  if (typeof o.question === 'string' && typeof o.templateId !== 'string') return null
  const templateId = typeof o.templateId === 'string' ? o.templateId.trim() : ''
  if (!GROUNDING_QUESTION_TEMPLATE_ID_SET.has(templateId)) return null
  const anchor = typeof o.anchor === 'string' ? o.anchor.trim() : undefined
  return {
    templateId: templateId as GroundingQuestionTemplateId,
    anchor: anchor && anchor.length > 0 ? anchor : undefined,
  }
}

function buildTemplateSelectionPrompt(input: {
  filledFacets: string[]
  thoughtLines: string[]
}): string {
  const templateGuide = GROUNDING_QUESTION_TEMPLATE_IDS.map((id) => `- ${id}`).join('\n')

  return [
    'Return ONLY JSON with one of these shapes:',
    '{"templateId": "<id>", "anchor"?: "<short label from captures>"}',
    '{"skip": true}',
    '',
    'You choose a blank-filling question template for a personal memory app.',
    'Do NOT write custom question text. Pick exactly one templateId from the list or skip.',
    '',
    'Approved templateIds:',
    templateGuide,
    '',
    'When to use each template (pick only when a concrete enrichment blank exists):',
    '- work_where / work_role: workplace or role unclear for classifying work captures.',
    '- main_project: an initiative in captures may be an active project vs a casual mention.',
    '- person_disambiguation: a person name appears but their role (colleague, friend, family) is unclear. Requires anchor = the name.',
    '- self_name_disambiguation: a first name in captures might be the user or someone else. Requires anchor = that name.',
    '- commute / weekday_routine / where_based / spare_time: daily context missing and would help interpret captures.',
    '- kids / household / music: only when relationship or interest context is missing and recent captures suggest it would help.',
    '',
    'Rules:',
    '- Skip if no concrete blank — never ask just to fill a card.',
    '- Prefer facets not already covered in the profile below.',
    '- Use anchor only when that exact label appears in recent captures (company, project, or person name).',
    '- Anchored templates (person_disambiguation, self_name_disambiguation) require anchor.',
    '- Never pick psychology-style or narrative questions — they are not in the list.',
    '- If recent captures give no useful angle, return {"skip": true}.',
    '',
    `Already captured facet keys: ${input.filledFacets.length > 0 ? input.filledFacets.join(', ') : '(none)'}`,
    'Recent captures (most recent first):',
    input.thoughtLines.join('\n'),
  ].join('\n')
}

export async function generateGroundingQuestion(userId: string): Promise<GroundingQuestion | null> {
  const [recentThoughts, profile] = await Promise.all([
    loadRecentThoughtsForGroundingQuestion(userId),
    loadGroundingProfileRow(userId),
  ])

  const filledFacets = Object.keys(profile?.facets ?? {})
  const thoughtLines =
    recentThoughts.length > 0
      ? recentThoughts.map((t, i) => `${i + 1}. [${t.category}] ${t.normalizedText}`)
      : ['(none yet)']

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You select one approved grounding question template to fill an enrichment blank. JSON only — never write free-form question text.',
    },
    {
      role: 'user',
      content: buildTemplateSelectionPrompt({ filledFacets, thoughtLines }),
    },
  ]

  const response = await llmChatCompletion({
    userId,
    messages,
    temperature: 0,
    logContext: 'grounding_next_question',
  })

  const content = (response as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]
    ?.message?.content
  if (typeof content !== 'string') {
    throw new Error('generateGroundingQuestion: missing LLM content')
  }

  try {
    const selection = parseTemplateSelectionOutput(content)
    if (!selection) return null
    return buildGroundingQuestionFromTemplate(selection)
  } catch {
    return null
  }
}
