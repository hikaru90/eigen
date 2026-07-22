import type { ChatMessage } from '$lib/server/llm/llm-client'
import type { PersistedChatMessage } from '$lib/chat/normalize-messages'

/** Soft cap so long sessions do not blow the agent context window. */
export const DEFAULT_AGENT_HISTORY_CHAR_BUDGET = 24_000

const TOOL_RESULT_PREFIX = 'Tool result for '
const TOOL_RESULT_SUFFIX =
  '\n\nIf more tools are needed, call one now. Otherwise give your final answer using {"answer": "<your response>"}.'

type PendingToolCall = {
  tool: string
  arguments: Record<string, unknown>
}

function isToolResultUserMessage(content: string): boolean {
  return content.startsWith(TOOL_RESULT_PREFIX)
}

function assistantToolCallContent(tool: string, args: Record<string, unknown>): string {
  return JSON.stringify({ tool, arguments: args })
}

function toolResultUserContent(tool: string, preview: string): string {
  return `${TOOL_RESULT_PREFIX}${tool}:\n${preview}${TOOL_RESULT_SUFFIX}`
}

function assistantAnswerContent(text: string): string {
  return JSON.stringify({ answer: text })
}

function pushToolPair(
  out: ChatMessage[],
  tool: string,
  args: Record<string, unknown>,
  preview: string,
): void {
  out.push({ role: 'assistant', content: assistantToolCallContent(tool, args) })
  out.push({ role: 'user', content: toolResultUserContent(tool, preview) })
}

/**
 * Map persisted session rows to the ChatMessage[] shape the agent loop already uses
 * (assistant tool JSON + user "Tool result for …" pairs, then {"answer":…}).
 * Skips thinking / executing / progress rows.
 */
export function buildAgentHistoryFromSessionMessages(
  messages: PersistedChatMessage[],
): ChatMessage[] {
  const out: ChatMessage[] = []
  let pending: PendingToolCall | null = null

  for (const m of messages) {
    if (m.role === 'user') {
      pending = null
      out.push({ role: 'user', content: m.content })
      continue
    }
    if (m.role !== 'assistant') continue

    const meta = m.metadata ?? {}
    const variant = typeof meta.variant === 'string' ? meta.variant : undefined

    if (variant === 'thinking' || variant === 'tool_executing' || variant === 'tool_progress') {
      continue
    }

    if (variant === 'tool_step') {
      pending = null
      const tool = typeof meta.tool === 'string' ? meta.tool : ''
      if (!tool) continue
      const args =
        meta.arguments && typeof meta.arguments === 'object' && !Array.isArray(meta.arguments)
          ? (meta.arguments as Record<string, unknown>)
          : {}
      pushToolPair(out, tool, args, m.content)
      continue
    }

    if (variant === 'tool_call') {
      const tool = typeof meta.tool === 'string' ? meta.tool : ''
      if (!tool) continue
      const args =
        meta.arguments && typeof meta.arguments === 'object' && !Array.isArray(meta.arguments)
          ? (meta.arguments as Record<string, unknown>)
          : {}
      pending = { tool, arguments: args }
      continue
    }

    if (variant === 'tool_result') {
      const tool = typeof meta.tool === 'string' ? meta.tool : ''
      if (pending && tool && pending.tool === tool) {
        pushToolPair(out, pending.tool, pending.arguments, m.content)
        pending = null
      } else if (tool) {
        // Orphan result — still give the model the outcome.
        pushToolPair(out, tool, {}, m.content)
        pending = null
      }
      continue
    }

    // Plain assistant final answer (no tool metadata).
    pending = null
    const text = m.content.trim()
    if (!text) continue
    out.push({ role: 'assistant', content: assistantAnswerContent(text) })
  }

  return out
}

/**
 * Drop oldest messages until under charBudget. Avoid starting mid tool-result pair.
 */
export function trimAgentHistory(
  messages: ChatMessage[],
  charBudget: number = DEFAULT_AGENT_HISTORY_CHAR_BUDGET,
): ChatMessage[] {
  let total = messages.reduce((n, m) => n + m.content.length, 0)
  if (total <= charBudget) return messages

  const out = [...messages]
  while (out.length > 0 && total > charBudget) {
    const removed = out.shift()!
    total -= removed.content.length
  }

  // Do not leave a dangling tool-result user message at the front.
  while (out.length > 0 && out[0].role === 'user' && isToolResultUserMessage(out[0].content)) {
    const removed = out.shift()!
    total -= removed.content.length
  }

  return out
}

/** Load prior rows → agent history ready for agentChat (trimmed). */
export function sessionMessagesToAgentHistory(
  messages: PersistedChatMessage[],
  charBudget: number = DEFAULT_AGENT_HISTORY_CHAR_BUDGET,
): ChatMessage[] {
  return trimAgentHistory(buildAgentHistoryFromSessionMessages(messages), charBudget)
}
