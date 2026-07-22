export const RELEVANCE_QUESTION_TEMPLATE_IDS = [
  'thought_still_relevant',
  'thought_still_on_mind',
] as const

export type RelevanceQuestionTemplateId = (typeof RELEVANCE_QUESTION_TEMPLATE_IDS)[number]

export const RELEVANCE_QUESTION_TEMPLATE_ID_SET = new Set<string>(RELEVANCE_QUESTION_TEMPLATE_IDS)

type RelevanceQuestionTemplate = {
  requiresSnippet: boolean
  build: (snippet: string) => string | null
}

function clipSnippet(snippet: string, max = 120): string {
  const trimmed = snippet.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1)}…`
}

export const RELEVANCE_QUESTION_TEMPLATES: Record<
  RelevanceQuestionTemplateId,
  RelevanceQuestionTemplate
> = {
  thought_still_relevant: {
    requiresSnippet: true,
    build: (snippet) => {
      const clipped = clipSnippet(snippet)
      if (!clipped) return null
      return `This from a while ago — still relevant for you?\n\n“${clipped}”`
    },
  },
  thought_still_on_mind: {
    requiresSnippet: true,
    build: (snippet) => {
      const clipped = clipSnippet(snippet)
      if (!clipped) return null
      return `Is this still on your mind, or can we let it fade?\n\n“${clipped}”`
    },
  },
}

export function buildRelevanceQuestionFromTemplate(input: {
  templateId: RelevanceQuestionTemplateId
  snippet: string
}): { templateId: RelevanceQuestionTemplateId; question: string; snippet: string } | null {
  const template = RELEVANCE_QUESTION_TEMPLATES[input.templateId]
  const snippet = clipSnippet(input.snippet)
  if (template.requiresSnippet && snippet.length === 0) return null
  const question = template.build(snippet)?.trim()
  if (!question) return null
  return { templateId: input.templateId, question, snippet }
}
