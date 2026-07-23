import { llmChatCompletion } from '$lib/server/llm/llm-client'
import { stripMarkdownJsonFences } from '$lib/server/memory/llm-json-content'
import { m } from '$lib/paraglide/messages.js'
import { validateNonEmptyEntityId } from '$lib/server/validation/mcp-args'

export type ProjectTimelineMilestone = {
  label: string
  targetDate: string | null
  linkedThoughtId: string | null
}

export type ProjectTimelineExtraction = {
  targetDate: string | null
  milestones: ProjectTimelineMilestone[]
}

function isValidIsoDate(value: string): boolean {
  const ms = Date.parse(value)
  return Number.isFinite(ms)
}

function parseOptionalIso(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed || !isValidIsoDate(trimmed)) return null
  return new Date(trimmed).toISOString()
}

export function parseProjectTimelinePayload(
  raw: unknown,
  allowedThoughtIds: Set<string>,
): ProjectTimelineExtraction {
  if (!raw || typeof raw !== 'object') {
    return { targetDate: null, milestones: [] }
  }
  const obj = raw as Record<string, unknown>
  const targetDate = parseOptionalIso(
    obj.targetDate !== undefined ? obj.targetDate : obj.target_date,
  )

  const rawMilestones = Array.isArray(obj.milestones) ? obj.milestones : []
  const milestones: ProjectTimelineMilestone[] = []
  for (const entry of rawMilestones) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const label = typeof row.label === 'string' ? row.label.trim() : ''
    if (!label) continue
    const linkedRaw =
      typeof row.linkedThoughtId === 'string'
        ? row.linkedThoughtId
        : typeof row.linked_thought_id === 'string'
          ? row.linked_thought_id
          : null
    let linkedThoughtId: string | null = null
    if (linkedRaw) {
      try {
        const id = validateNonEmptyEntityId(linkedRaw, 'linkedThoughtId')
        if (allowedThoughtIds.has(id)) linkedThoughtId = id
        else continue
      } catch {
        continue
      }
    }
    milestones.push({
      label,
      targetDate: parseOptionalIso(
        row.targetDate !== undefined ? row.targetDate : row.target_date,
      ),
      linkedThoughtId,
    })
  }

  return { targetDate, milestones }
}

function extractChatContent(response: unknown): string {
  const choices = (response as { choices?: Array<{ message?: { content?: string } }> }).choices
  const content = choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error('extractProjectTimeline: missing LLM content')
  }
  return content
}

export async function extractProjectTimeline(input: {
  userId: string
  projectLabel: string
  linkedThoughts: Array<{ thoughtId: string; summary: string }>
  existingDeadlines: Array<{ thoughtId: string; summary: string; startAt: string }>
}): Promise<ProjectTimelineExtraction> {
  const allowed = new Set(input.linkedThoughts.map((t) => t.thoughtId))
  const thoughtCatalog = input.linkedThoughts
    .map((t) => `- ${t.thoughtId}: ${t.summary}`)
    .join('\n')
  const deadlineCatalog = input.existingDeadlines
    .map((d) => `- ${d.thoughtId} @ ${d.startAt}: ${d.summary}`)
    .join('\n')

  const prompt = [
    'Return ONLY JSON with this shape:',
    '{',
    '  "targetDate": "ISO-8601 datetime or null",',
    '  "milestones": [',
    '    { "label": "string", "targetDate": "ISO-8601 or null", "linkedThoughtId": "uuid from catalog or null" }',
    '  ]',
    '}',
    '',
    'Infer the overall project deadline and a short list of project-scoped milestones (deliverables / phase gates).',
    'Use linkedThoughtId only from the thought catalog. Prefer null when unsure.',
    'Do not invent thought ids.',
    '',
    `Project: ${input.projectLabel}`,
    '',
    'Linked thoughts:',
    thoughtCatalog || '(none)',
    '',
    'Existing thought deadlines:',
    deadlineCatalog || '(none)',
  ].join('\n')

  const response = await llmChatCompletion({
    userId: input.userId,
    messages: [
      {
        role: 'system',
        content: m.llm_project_timeline_system(),
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0,
  })

  const parsed = JSON.parse(stripMarkdownJsonFences(extractChatContent(response))) as unknown
  return parseProjectTimelinePayload(parsed, allowed)
}
