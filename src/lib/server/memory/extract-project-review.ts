import type {
  ProjectReviewExtraction,
  ProjectReviewNewTaskSuggestion,
  ProjectReviewSuggestion,
  ProjectReviewTaskInput,
  ProjectReviewTaskReview,
} from '$lib/memory/project-review-types'
import { m } from '$lib/paraglide/messages.js'
import type { TemporalEventKind } from '$lib/server/db/brain.schema'
import { llmChatCompletion } from '$lib/server/llm/llm-client'
import { stripMarkdownJsonFences } from '$lib/server/memory/llm-json-content'
import { validateNonEmptyEntityId } from '$lib/server/validation/mcp-args'

export type {
  ProjectReviewExtraction,
  ProjectReviewNewTaskSuggestion,
  ProjectReviewSuggestion,
  ProjectReviewTaskInput,
  ProjectReviewTaskReview,
}

const ALLOWED_KINDS = new Set<TemporalEventKind>([
  'deadline',
  'appointment',
  'milestone',
  'period',
  'reminder',
  'inferred_event',
])

const ALLOWED_SUGGESTIONS = new Set<ProjectReviewSuggestion>(['keep', 'mark_done', 'archive'])

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

function parseSuggestion(raw: unknown): ProjectReviewSuggestion | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim() as ProjectReviewSuggestion
  return ALLOWED_SUGGESTIONS.has(trimmed) ? trimmed : null
}

function extractChatContent(response: unknown): string {
  const choices = (response as { choices?: Array<{ message?: { content?: string } }> }).choices
  const content = choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error('extractProjectReview: missing LLM content')
  }
  return content
}

export function parseProjectReviewPayload(
  raw: unknown,
  allowedThoughtIds: Set<string>,
): ProjectReviewExtraction {
  if (!raw || typeof raw !== 'object') {
    return {
      projectDeadline: null,
      taskReviews: [],
      order: [],
      newTaskSuggestions: [],
      nextActionThoughtId: null,
      nextActionIsNewTaskIndex: null,
    }
  }

  const obj = raw as Record<string, unknown>
  const projectDeadline = parseOptionalIso(
    obj.projectDeadline !== undefined ? obj.projectDeadline : obj.project_deadline,
  )

  const rawReviews = Array.isArray(obj.taskReviews)
    ? obj.taskReviews
    : Array.isArray(obj.task_reviews)
      ? obj.task_reviews
      : []
  const taskReviews: ProjectReviewTaskReview[] = []
  const seenReviewIds = new Set<string>()
  for (const entry of rawReviews) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const thoughtRaw =
      typeof row.thoughtId === 'string'
        ? row.thoughtId
        : typeof row.thought_id === 'string'
          ? row.thought_id
          : ''
    let thoughtId: string
    try {
      thoughtId = validateNonEmptyEntityId(thoughtRaw, 'thoughtId')
    } catch {
      continue
    }
    if (!allowedThoughtIds.has(thoughtId) || seenReviewIds.has(thoughtId)) continue
    const suggestion = parseSuggestion(row.suggestion)
    if (!suggestion) continue
    const reason = typeof row.reason === 'string' ? row.reason.trim() : ''
    taskReviews.push({
      thoughtId,
      suggestion,
      deadline: parseOptionalIso(row.deadline),
      reason,
    })
    seenReviewIds.add(thoughtId)
  }

  const rawOrder = Array.isArray(obj.order) ? obj.order : []
  const order: string[] = []
  const seenOrder = new Set<string>()
  for (const entry of rawOrder) {
    if (typeof entry !== 'string') continue
    let id: string
    try {
      id = validateNonEmptyEntityId(entry, 'thoughtId')
    } catch {
      continue
    }
    if (!allowedThoughtIds.has(id) || seenOrder.has(id)) continue
    order.push(id)
    seenOrder.add(id)
  }

  const rawNew = Array.isArray(obj.newTaskSuggestions)
    ? obj.newTaskSuggestions
    : Array.isArray(obj.new_task_suggestions)
      ? obj.new_task_suggestions
      : []
  const newTaskSuggestions: ProjectReviewNewTaskSuggestion[] = []
  for (const entry of rawNew) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const summary = typeof row.summary === 'string' ? row.summary.trim() : ''
    if (!summary) continue
    const reason = typeof row.reason === 'string' ? row.reason.trim() : ''
    newTaskSuggestions.push({
      summary,
      kind: parseOptionalKind(row.kind),
      suggestedStartAt: parseOptionalIso(
        row.suggestedStartAt !== undefined ? row.suggestedStartAt : row.suggested_start_at,
      ),
      suggestedEndAt: parseOptionalIso(
        row.suggestedEndAt !== undefined ? row.suggestedEndAt : row.suggested_end_at,
      ),
      reason,
    })
  }

  const nextActionRaw =
    typeof obj.nextActionThoughtId === 'string'
      ? obj.nextActionThoughtId
      : typeof obj.next_action_thought_id === 'string'
        ? obj.next_action_thought_id
        : null
  let nextActionThoughtId: string | null = null
  if (nextActionRaw) {
    try {
      const id = validateNonEmptyEntityId(nextActionRaw, 'nextActionThoughtId')
      if (allowedThoughtIds.has(id)) nextActionThoughtId = id
    } catch {
      nextActionThoughtId = null
    }
  }

  const nextIndexRaw =
    obj.nextActionIsNewTaskIndex !== undefined
      ? obj.nextActionIsNewTaskIndex
      : obj.next_action_is_new_task_index
  let nextActionIsNewTaskIndex: number | null = null
  if (typeof nextIndexRaw === 'number' && Number.isInteger(nextIndexRaw) && nextIndexRaw >= 0) {
    if (nextIndexRaw < newTaskSuggestions.length) {
      nextActionIsNewTaskIndex = nextIndexRaw
    }
  }

  return {
    projectDeadline,
    taskReviews,
    order,
    newTaskSuggestions,
    nextActionThoughtId,
    nextActionIsNewTaskIndex,
  }
}

export async function extractProjectReview(input: {
  userId: string
  projectLabel: string
  tasks: ProjectReviewTaskInput[]
  linkedThoughts: Array<{ thoughtId: string; summary: string }>
  projectDeadline: string | null
  goal?: string
}): Promise<ProjectReviewExtraction> {
  const allowed = new Set(input.tasks.map((t) => t.thoughtId))
  const taskCatalog = input.tasks
    .map(
      (t) =>
        `- ${t.thoughtId}: [${t.status}] rank=${t.rank}` +
        `${t.isNextAction ? ' NEXT' : ''}` +
        `${t.deadline ? ` deadline=${t.deadline}` : ''}` +
        ` — ${t.summary}`,
    )
    .join('\n')
  const linkedCatalog = input.linkedThoughts
    .map((t) => `- ${t.thoughtId}: ${t.summary}`)
    .join('\n')

  const prompt = [
    'Return ONLY JSON with this shape:',
    '{',
    '  "projectDeadline": "ISO-8601 datetime or null",',
    '  "taskReviews": [',
    '    { "thoughtId": "uuid from task catalog", "suggestion": "keep|mark_done|archive",',
    '      "deadline": "ISO-8601 or null", "reason": "short explanation" }',
    '  ],',
    '  "order": ["uuid from task catalog", "..."],',
    '  "newTaskSuggestions": [',
    '    { "summary": "concrete action text", "kind": "deadline|appointment|milestone|period|reminder|inferred_event|null",',
    '      "suggestedStartAt": "ISO-8601 or null", "suggestedEndAt": "ISO-8601 or null", "reason": "why this gap" }',
    '  ],',
    '  "nextActionThoughtId": "uuid from task catalog or null",',
    '  "nextActionIsNewTaskIndex": "integer index into newTaskSuggestions or null"',
    '}',
    '',
    'You are reviewing an EXISTING GTD project — not inventing a greenfield plan.',
    'Suggest which existing tasks to keep, mark done, or archive; propose deadlines and a reconciled order;',
    'suggest NEW tasks only for real gaps (do not duplicate existing open tasks).',
    'thoughtId and order entries MUST come from the task catalog. Do not invent thought ids.',
    'Prefer nextActionThoughtId for an existing open task; use nextActionIsNewTaskIndex only when the next action is a new suggestion.',
    'Set exactly one of nextActionThoughtId or nextActionIsNewTaskIndex when there is an actionable next step.',
    '',
    `Project: ${input.projectLabel}`,
    input.projectDeadline ? `Current project deadline: ${input.projectDeadline}` : 'Current project deadline: (none)',
    input.goal?.trim() ? `Goal: ${input.goal.trim()}` : '',
    '',
    'Existing tasks:',
    taskCatalog || '(none)',
    '',
    'Other linked thoughts (context, not tasks):',
    linkedCatalog || '(none)',
  ]
    .filter((line) => line !== '')
    .join('\n')

  const response = await llmChatCompletion({
    userId: input.userId,
    messages: [
      {
        role: 'system',
        content: m.llm_project_review_system(),
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0,
  })

  const parsed = JSON.parse(stripMarkdownJsonFences(extractChatContent(response))) as unknown
  return parseProjectReviewPayload(parsed, allowed)
}
