import {
  lifecycleStatusEnum,
  temporalEventKindEnum,
  type LifecycleStatus,
} from '$lib/server/db/brain.schema'
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client'
import { extractChatContent } from '$lib/server/ontology/llm-json'

export type TemporalEventQuickAction = 'mark_done' | 'reopen' | 'archive'

/** Legacy MCP/UI aliases mapped to archive. */
export type TemporalEventLegacyQuickAction = 'cancel' | 'dismiss' | 'delete'

export type TemporalEventActionInput = TemporalEventQuickAction | TemporalEventLegacyQuickAction

export type AppliedTemporalEventAction = {
  action: TemporalEventQuickAction | 'reschedule' | 'snooze' | 'update'
  lifecycleStatus?: LifecycleStatus
  startAt?: string | null
  endAt?: string | null
  snoozedUntil?: string | null
  thoughtTextPatch?: string | null
  summary: string
}

const ALLOWED_LIFECYCLE = new Set<LifecycleStatus>(lifecycleStatusEnum)

function normalizeLegacyAction(action: string): TemporalEventQuickAction | null {
  if (action === 'cancel' || action === 'dismiss' || action === 'delete') {
    return 'archive'
  }
  if (action === 'mark_done' || action === 'reopen' || action === 'archive') {
    return action
  }
  return null
}

function parseAppliedTemporalActionJson(text: string): AppliedTemporalEventAction {
  let trimmed = text.trim()
  const fence = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)```\s*$/)
  if (fence) trimmed = fence[1].trim()

  const parsed = JSON.parse(trimmed) as Record<string, unknown>
  const actionRaw = typeof parsed.action === 'string' ? parsed.action.trim() : ''
  const normalized = normalizeLegacyAction(actionRaw)
  const structuralActions = new Set(['reschedule', 'snooze', 'update'])
  if (!normalized && !structuralActions.has(actionRaw)) {
    throw new Error(`Invalid temporal event action: ${actionRaw || '(missing)'}`)
  }

  const action = (normalized ?? actionRaw) as AppliedTemporalEventAction['action']

  let lifecycleStatus: LifecycleStatus | undefined
  if (typeof parsed.lifecycleStatus === 'string') {
    if (parsed.lifecycleStatus === 'cancelled' || parsed.lifecycleStatus === 'dismissed') {
      lifecycleStatus = 'archived'
    } else if (ALLOWED_LIFECYCLE.has(parsed.lifecycleStatus as LifecycleStatus)) {
      lifecycleStatus = parsed.lifecycleStatus as LifecycleStatus
    }
  }

  const startAt =
    parsed.startAt === null
      ? null
      : typeof parsed.startAt === 'string' && parsed.startAt.trim()
        ? parsed.startAt.trim()
        : undefined
  const endAt =
    parsed.endAt === null
      ? null
      : typeof parsed.endAt === 'string' && parsed.endAt.trim()
        ? parsed.endAt.trim()
        : undefined
  const snoozedUntil =
    parsed.snoozedUntil === null
      ? null
      : typeof parsed.snoozedUntil === 'string' && parsed.snoozedUntil.trim()
        ? parsed.snoozedUntil.trim()
        : undefined

  const thoughtTextPatch =
    parsed.thoughtTextPatch === null
      ? null
      : typeof parsed.thoughtTextPatch === 'string' && parsed.thoughtTextPatch.trim()
        ? parsed.thoughtTextPatch.trim()
        : undefined

  const summary =
    typeof parsed.summary === 'string' && parsed.summary.trim()
      ? parsed.summary.trim()
      : 'Event updated.'

  return {
    action,
    lifecycleStatus,
    startAt,
    endAt,
    snoozedUntil,
    thoughtTextPatch,
    summary,
  }
}

/**
 * Resolve a natural-language instruction against a temporal event.
 */
export async function applyTemporalEventActionRequest(input: {
  userId: string
  instruction: string
  event: {
    id: string
    kind: string
    semanticSummary: string
    startAt: string | null
    endAt: string | null
    timezone: string
    lifecycleStatus: LifecycleStatus
    thoughtText: string
  }
  nowIso: string
  userTimezone: string
}): Promise<AppliedTemporalEventAction> {
  const instruction = input.instruction.trim()
  if (!instruction) {
    throw new Error('instruction is required')
  }

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'You apply a natural-language instruction to a personal calendar/temporal event.',
        'Return JSON only:',
        '{',
        '  "action": "mark_done" | "reopen" | "archive" | "reschedule" | "snooze" | "update",',
        `  "lifecycleStatus": ${lifecycleStatusEnum.map((s) => `"${s}"`).join(' | ')} | null,`,
        '  "startAt": "<ISO-8601 or null>",',
        '  "endAt": "<ISO-8601 or null>",',
        '  "snoozedUntil": "<ISO-8601 or null>",',
        '  "thoughtTextPatch": "<full updated source thought text or null>",',
        '  "summary": "<one sentence describing what changed>"',
        '}',
        'Rules:',
        `- Allowed event kinds: ${temporalEventKindEnum.join(', ')}.`,
        '- Use user timezone for relative dates ("tomorrow", "next Monday").',
        '- For reschedule/snooze, set startAt/endAt or snoozedUntil as ISO instants.',
        '- When dates change, provide thoughtTextPatch with the full updated thought reflecting the new schedule.',
        '- For mark done use lifecycleStatus "completed"; for dismiss/cancel/not relevant use "archived".',
        '- Do not invent facts beyond the instruction.',
        '- summary must name the concrete change.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Current time (UTC): ${input.nowIso}`,
        `User timezone: ${input.userTimezone}`,
        `Event id: ${input.event.id}`,
        `Kind: ${input.event.kind}`,
        `Summary: ${input.event.semanticSummary}`,
        `Lifecycle: ${input.event.lifecycleStatus}`,
        `Start: ${input.event.startAt ?? '(none)'}`,
        `End: ${input.event.endAt ?? '(none)'}`,
        `Event timezone: ${input.event.timezone}`,
        `Source thought:\n${input.event.thoughtText}`,
        `Instruction: ${instruction}`,
      ].join('\n\n'),
    },
  ]

  const response = await llmChatCompletion({
    userId: input.userId,
    messages,
    temperature: 0,
    logContext: 'apply_temporal_event_action',
  })

  const content = extractChatContent(response)
  try {
    return parseAppliedTemporalActionJson(content)
  } catch (err) {
    throw new Error(
      `Failed to parse temporal event action LLM response: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    )
  }
}

export function normalizeTemporalEventQuickAction(
  action: TemporalEventActionInput,
): TemporalEventQuickAction {
  const normalized = normalizeLegacyAction(action)
  if (!normalized) {
    throw new Error(`Invalid temporal event action: ${action}`)
  }
  return normalized
}

export function quickActionToLifecycle(action: TemporalEventQuickAction): LifecycleStatus {
  switch (action) {
    case 'mark_done':
      return 'completed'
    case 'reopen':
      return 'open'
    case 'archive':
      return 'archived'
  }
}
