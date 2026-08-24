import { m } from '$lib/paraglide/messages.js'
import type { TemporalEventKind } from '$lib/server/db/brain.schema'
import { llmChatCompletion } from '$lib/server/llm/llm-client'
import { stripMarkdownJsonFences } from '$lib/server/memory/llm-json-content'
import { validateNonEmptyEntityId } from '$lib/server/validation/mcp-args'

export type ProjectTimelineMilestone = {
  label: string
  targetDate: string | null
  linkedThoughtId: string | null
}

export type ProjectTimelineTask = {
  summary: string
  kind: TemporalEventKind | null
  suggestedStartAt: string | null
  suggestedEndAt: string | null
  isNextAction: boolean
}

export type ProjectTimelineExtraction = {
  targetDate: string | null
  milestones: ProjectTimelineMilestone[]
  tasks: ProjectTimelineTask[]
}

const ALLOWED_KINDS = new Set<TemporalEventKind>([
  'deadline',
  'appointment',
  'milestone',
  'period',
  'reminder',
  'inferred_event',
])

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

function parseOptionalKind(raw: unknown): TemporalEventKind | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim() as TemporalEventKind
  return ALLOWED_KINDS.has(trimmed) ? trimmed : null
}

export function parseProjectTimelinePayload(
  raw: unknown,
  allowedThoughtIds: Set<string>,
): ProjectTimelineExtraction {
  if (!raw || typeof raw !== 'object') {
    return { targetDate: null, milestones: [], tasks: [] }
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

  const rawTasks = Array.isArray(obj.tasks) ? obj.tasks : []
  const tasks: ProjectTimelineTask[] = []
  for (const entry of rawTasks) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const summary = typeof row.summary === 'string' ? row.summary.trim() : ''
    if (!summary) continue
    const isNextAction =
      row.isNextAction === true ||
      row.is_next_action === true ||
      (typeof row.isNextAction === 'string' && row.isNextAction.toLowerCase() === 'true') ||
      (typeof row.is_next_action === 'string' && row.is_next_action.toLowerCase() === 'true')
    tasks.push({
      summary,
      kind: parseOptionalKind(row.kind),
      suggestedStartAt: parseOptionalIso(
        row.suggestedStartAt !== undefined ? row.suggestedStartAt : row.suggested_start_at,
      ),
      suggestedEndAt: parseOptionalIso(
        row.suggestedEndAt !== undefined ? row.suggestedEndAt : row.suggested_end_at,
      ),
      isNextAction,
    })
  }

  return { targetDate, milestones, tasks }
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
  goal?: string
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
    '  ],',
    '  "tasks": [',
    '    {',
    '      "summary": "concrete next-step task text",',
    '      "kind": "deadline|appointment|milestone|period|reminder|inferred_event|null",',
    '      "suggestedStartAt": "ISO-8601 or null",',
    '      "suggestedEndAt": "ISO-8601 or null",',
    '      "isNextAction": true|false',
    '    }',
    '  ]',
    '}',
    '',
    'Infer the overall project deadline, project-scoped milestones (deliverables / phase gates),',
    'and an ordered task waterfall the user should execute.',
    'Mark exactly one task as isNextAction when tasks are non-empty (the first actionable step).',
    'Use linkedThoughtId only from the thought catalog. Prefer null when unsure.',
    'Do not invent thought ids.',
    'Task summaries must be concrete actions, not vague goals.',
    '',
    `Project: ${input.projectLabel}`,
    input.goal?.trim() ? `Goal: ${input.goal.trim()}` : '',
    '',
    'Linked thoughts:',
    thoughtCatalog || '(none)',
    '',
    'Existing thought deadlines:',
    deadlineCatalog || '(none)',
  ]
    .filter((line) => line !== '')
    .join('\n')

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
