import { truncateEditPreview } from '$lib/server/capture/edit-phase-timing'
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client'
import { extractChatContent } from '$lib/server/ontology/llm-json'
import { lifecycleStatusEnum, type LifecycleStatus } from '$lib/server/db/brain.schema'

/** @deprecated Use LifecycleStatus from brain.schema */
export type ThoughtLifecycleStatus = LifecycleStatus

const LIFECYCLE_COMPLETE_COMMANDS = [
  'mark as completed',
  'mark as complete',
  'mark complete',
  'mark as done',
  'mark done',
  'set as done',
  'set to done',
  'set to completed',
  'set to complete',
] as const

const LIFECYCLE_OPEN_COMMANDS = ['reopen', 'mark as open', 'set to open'] as const

const LIFECYCLE_ARCHIVE_COMMANDS = [
  'archive',
  'mark as archived',
  'dismiss',
  'not relevant',
  'no longer relevant',
  'irrelevant',
  'outdated',
  'out of date',
  'not up to date',
  'remove from active',
  'soft delete',
  'soft-delete',
  'delete',
] as const

/** Strip polite / deictic filler so protocol verbs still match (e.g. "please mark this thought as done"). */
function normalizeLifecycleProtocolText(editRequest: string): string {
  return editRequest
    .trim()
    .toLowerCase()
    .replace(/^(please|kindly|can you|could you)\s+/i, '')
    .replace(/\b(this|that|the)\s+(thought|todo|to-do|task|item|memory|one)\b/g, '')
    .replace(/\b(this|that|it)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function matchesLifecycleCommand(
  normalized: string,
  command: string,
  opts?: { exactOnly?: boolean },
): boolean {
  if (opts?.exactOnly) {
    return normalized === command
  }
  return (
    normalized === command ||
    normalized.startsWith(`${command} `) ||
    normalized.startsWith(`${command}—`) ||
    normalized.startsWith(`${command}-`)
  )
}

/**
 * Recognize explicit lifecycle edit commands (MCP/UI protocol).
 * Not semantic classification of thought content — only routes known status verbs.
 * Category is irrelevant: any thought may be completed or archived.
 */
export function parseLifecycleEditRequest(editRequest: string): LifecycleStatus | null {
  const normalized = normalizeLifecycleProtocolText(editRequest)
  if (!normalized) return null

  for (const command of LIFECYCLE_COMPLETE_COMMANDS) {
    if (matchesLifecycleCommand(normalized, command)) {
      return 'completed'
    }
  }
  for (const command of LIFECYCLE_OPEN_COMMANDS) {
    if (matchesLifecycleCommand(normalized, command)) {
      return 'open'
    }
  }
  for (const command of LIFECYCLE_ARCHIVE_COMMANDS) {
    // Bare "delete" only after filler stripping ("delete this thought" → "delete").
    // Do not treat "delete the second sentence" as archive.
    const exactOnly = command === 'delete'
    if (matchesLifecycleCommand(normalized, command, { exactOnly })) {
      return 'archived'
    }
  }
  return null
}

export type AppliedThoughtEdit = {
  rawText: string
  /** When set, merged into thought.metadata.status */
  status?: LifecycleStatus | null
  /** Short description of what changed (for chat traceability). */
  summary: string
}

function parseAppliedEditJson(text: string, fallbackRaw: string): AppliedThoughtEdit {
  let trimmed = text.trim()
  const fence = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)```\s*$/)
  if (fence) trimmed = fence[1].trim()

  const parsed = JSON.parse(trimmed) as Record<string, unknown>
  const rawText = typeof parsed.rawText === 'string' ? parsed.rawText.trim() : fallbackRaw
  if (!rawText) {
    throw new Error('LLM edit response missing non-empty rawText')
  }
  let status: LifecycleStatus | null | undefined
  if (lifecycleStatusEnum.includes(parsed.status as LifecycleStatus)) {
    status = parsed.status as LifecycleStatus
  } else if (parsed.status === null) {
    status = null
  }

  const summary =
    typeof parsed.summary === 'string' && parsed.summary.trim()
      ? parsed.summary.trim()
      : 'Thought updated.'

  return { rawText, status, summary }
}

/**
 * Resolve a natural-language edit request against existing thought text.
 * Completion-only requests preserve body text and set metadata.status.
 */
export async function applyThoughtEditRequest(input: {
  userId: string
  existingRawText: string
  existingNormalizedText: string
  category: string
  editRequest: string
}): Promise<AppliedThoughtEdit> {
  const editRequest = input.editRequest.trim()
  if (!editRequest) {
    throw new Error('editRequest is required')
  }

  console.info('[capture.edit.llm] request', {
    userId: input.userId,
    category: input.category,
    editRequestPreview: truncateEditPreview(editRequest),
    existingRawLen: input.existingRawText.length,
  })

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'You apply a natural-language edit to a stored personal thought.',
        'Return JSON only:',
        `{ "rawText": "<full updated thought body>", "status": ${lifecycleStatusEnum.map((s) => `"${s}"`).join(' | ')} | null, "summary": "<one sentence: what changed>" }`,
        'Rules:',
        '- rawText must be the complete updated thought, not the edit instruction alone.',
        '- Category is metadata only. Never refuse a status change because the category is not "task" — thoughts, ideas, observations, and tasks are interchangeable for done/archive/delete.',
        '- When marking done/complete/finished, keep the original meaning; set status to "completed" unless the user also rewrites the text.',
        '- When archiving, dismissing, deleting, or calling something irrelevant/outdated/not up to date, set status to "archived" (soft-remove; same outcome as delete_thought).',
        '- Do not invent facts beyond the edit request.',
        '- summary must name the concrete change (e.g. marked complete, fixed typo, shortened).',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Category (informational only — does not restrict status): ${input.category}`,
        `Current text:\n${input.existingRawText}`,
        `Edit request: ${editRequest}`,
      ].join('\n\n'),
    },
  ]

  const response = await llmChatCompletion({
    userId: input.userId,
    messages,
    temperature: 0,
    logContext: 'apply_thought_edit',
  })

  const content = extractChatContent(response)
  try {
    const parsed = parseAppliedEditJson(content, input.existingRawText)
    console.info('[capture.edit.llm] parsed', {
      userId: input.userId,
      status: parsed.status ?? null,
      summary: parsed.summary,
      rawTextLen: parsed.rawText.length,
      textUnchanged: parsed.rawText === input.existingRawText,
    })
    return parsed
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[capture.edit.llm] parse failed', {
      userId: input.userId,
      message,
      responsePreview: truncateEditPreview(content, 400),
    })
    throw new Error(`Failed to parse thought edit LLM response: ${message}`)
  }
}
