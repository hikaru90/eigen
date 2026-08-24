import { m } from '$lib/paraglide/messages.js'
import { llmChatCompletion } from '$lib/server/llm/llm-client'
import { stripMarkdownJsonFences } from '$lib/server/memory/llm-json-content'
import { validateNonEmptyEntityId } from '$lib/server/validation/mcp-args'

export type ProjectOrderOpenTask = {
  thoughtId: string
  summary: string
}

/** Structural gate only — does not decide meaning. */
export function shouldInvokeProjectOrderJudge(openTaskCount: number): boolean {
  return openTaskCount >= 2
}

export function filterOrderedThoughtIds(
  orderedIds: string[],
  allowedThoughtIds: Set<string>,
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of orderedIds) {
    if (typeof raw !== 'string') continue
    let id: string
    try {
      id = validateNonEmptyEntityId(raw, 'thoughtId')
    } catch {
      continue
    }
    if (!allowedThoughtIds.has(id) || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

export function parseProjectOrderPayload(
  raw: unknown,
  allowedThoughtIds: Set<string>,
): string[] {
  if (!raw || typeof raw !== 'object') return []
  const obj = raw as Record<string, unknown>
  const list = Array.isArray(obj.orderedThoughtIds)
    ? obj.orderedThoughtIds
    : Array.isArray(obj.ordered_thought_ids)
      ? obj.ordered_thought_ids
      : null
  if (!list) return []
  return filterOrderedThoughtIds(
    list.filter((v): v is string => typeof v === 'string'),
    allowedThoughtIds,
  )
}

function extractChatContent(response: unknown): string {
  const choices = (response as { choices?: Array<{ message?: { content?: string } }> }).choices
  const content = choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error('extractProjectOrder: missing LLM content')
  }
  return content
}

export async function extractProjectOrder(input: {
  userId: string
  projectLabel: string
  openTasks: ProjectOrderOpenTask[]
}): Promise<string[]> {
  const allowed = new Set(input.openTasks.map((t) => t.thoughtId))
  if (!shouldInvokeProjectOrderJudge(input.openTasks.length)) {
    return input.openTasks.map((t) => t.thoughtId)
  }

  const taskCatalog = input.openTasks
    .map((t) => `- ${t.thoughtId}: ${t.summary}`)
    .join('\n')

  const prompt = [
    'Return ONLY JSON with this shape:',
    '{',
    '  "orderedThoughtIds": ["uuid", "..."]',
    '}',
    '',
    'Order these open tasks into a coherent waterfall (do earlier steps first) for the project.',
    'Include every task id from the catalog exactly once. Do not invent ids.',
    '',
    `Project: ${input.projectLabel}`,
    '',
    'Open tasks:',
    taskCatalog,
  ].join('\n')

  const response = await llmChatCompletion({
    userId: input.userId,
    messages: [
      {
        role: 'system',
        content: m.llm_project_order_system(),
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0,
  })

  const parsed = JSON.parse(stripMarkdownJsonFences(extractChatContent(response))) as unknown
  const ordered = parseProjectOrderPayload(parsed, allowed)
  // Append any allowed ids the model omitted so ranks stay complete.
  for (const id of allowed) {
    if (!ordered.includes(id)) ordered.push(id)
  }
  return ordered
}
