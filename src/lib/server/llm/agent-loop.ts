import type { ChatStreamEvent } from '$lib/chat/chat-stream-types'
import { isUnpresentableFinalAnswer } from '$lib/chat/chat-stream-types'
import { AGENT_TOOL_ACTIVITY_PROVIDER } from '$lib/server/activity/gateway-providers'
import { logActivityCall } from '$lib/server/activity/log-call'
import { getDb } from '$lib/server/db'
import type { ChatSessionMode } from '$lib/server/db/brain.schema'
import {
  formatToolResultForAgentMessage,
  formatToolResultPreview,
} from '$lib/server/llm/agent-tool-result-compact'
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client'
import {
  buildAgentToolDescriptionBlock,
  isAgentTool,
  MCP_AGENT_TOOL_NAMES,
  MCP_TOOL_MAP,
} from '$lib/server/mcp/registry'
import type { McpToolContext } from '$lib/server/mcp/tools'
import { redactForLog } from '$lib/server/observability/redact-for-log'
import { sanitizeMcpToolResult } from '$lib/server/observability/strip-embeddings'
import {
  formatComposedAnswerForUser,
  type ComposedAnswer,
} from '$lib/server/qa/compose-answer'
import { readThoughtIdFromToolArgs } from '$lib/server/validation/mcp-args'

const MAX_ITERATIONS = 8
const MAX_PARSE_RETRIES = 3

/** Mutation / write tools — a final answer after these does not require answer_question. */
const AGENT_WRITE_TOOLS = new Set([
  'capture_thought',
  'edit_thought',
  'delete_thought',
  'create_text_file',
  'update_text_file',
  'append_text_file',
  'delete_text_file',
  'link_text_file_to_thought',
  'unlink_text_file_from_thought',
  'order_task_in_project',
  'set_project_milestone',
  'set_project_deadline',
  'generate_project_plan',
  'create_project',
  'edit_project',
  'delete_project',
])

const REMOVED_TOOL_HINTS: Record<string, string> = {
  list_temporal_events:
    'That tool was removed. For agendas/todos/deadlines use list_projects and get_project_timeline; for memory questions use answer_question.',
  manage_temporal_event:
    'That tool was removed. For project deadlines/milestones use set_project_deadline or set_project_milestone; for thought lifecycle use edit_thought.',
}

export class AgentParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentParseError'
  }
}

function isRetrieveThoughtsSearch(tool: string, args: Record<string, unknown>): boolean {
  if (tool !== 'retrieve_thoughts') return false
  const query = args.query
  return typeof query === 'string' && query.trim().length > 0
}

function formatUnknownToolError(tool: string): string {
  const available = `Available tools: ${MCP_AGENT_TOOL_NAMES.join(', ')}`
  const hint = REMOVED_TOOL_HINTS[tool]
  if (hint) {
    return `Error: tool "${tool}" is not available. ${hint} ${available}`
  }
  return `Error: tool "${tool}" is not available. ${available}`
}

const TOOL_DESCRIPTION_BLOCK = buildAgentToolDescriptionBlock()

/**
 * Thin chat agent: HTTP MCP thought tools plus chat-only text-note tools, with streaming visual feedback.
 * No router or classifiers.
 */
export const AGENT_SYSTEM_PROMPT = [
  "You are a text interface over the user's personal memory tools.",
  'Use the available tools to fulfill the user request, then answer.',
  '',
  'Respond with JSON only. To call a tool:',
  '{"tool": "<tool_name>", "arguments": {<args>}}',
  'When done:',
  '{"answer": "<your response>"}',
  '',
  '=== AVAILABLE TOOLS ===',
  TOOL_DESCRIPTION_BLOCK,
  '',
  '=== RULES ===',
  '- You must call at least one tool before giving a final answer. A final answer with no prior tool call in this turn is rejected.',
  '- Any question (how/what/when/who/why, any language): call answer_question — never answer a question from your own knowledge.',
  '- retrieve_thoughts is for browsing/listing recent thoughts, not for answering questions.',
  '- When unsure between capture and answer, prefer answer_question.',
  '- Notes tab documents (shopping lists, titled notes, notebooks, checklists) are text notes — never capture_thought for these (that stores a memory thought, not a Notes document).',
  '- Create a NEW note/list only: create_text_file with title and/or body (title-only is fine for an empty new list). Use create only when the user wants a fresh document, not when amending one that already exists.',
  '- Add / append / change content on a referenced note (e.g. "add milk to my shopping list"): search_text_files or list_text_files to find text_file_id, then append_text_file (or get_text_file + update_text_file for a full rewrite). Never create_text_file for additive requests on an existing named note/list.',
  '- Edit / rewrite a note title or full body: list_text_files or search_text_files to find text_file_id, then update_text_file.',
  '- Delete a note: list_text_files or search_text_files to find text_file_id, then delete_text_file.',
  '- Capture / remember something as a memory thought ("remember that…", open loops, facts to recall later — not a Notes document): capture_thought with the text to store.',
  '- Mark done / complete / finished / reopen / archive / irrelevant / outdated on a thought: retrieve_thoughts to find the thought id, then edit_thought (e.g. edit_request "mark as done", "archive", "not relevant") or delete_thought. Done/complete → completed; delete/irrelevant/outdated → archived. Both soft-remove from active memory.',
  '- Category never matters for thought lifecycle: task, idea, observation, fact, etc. are interchangeable. Never refuse "mark as done" because something is "a thought not a todo".',
  '- Delete / remove a memory thought: retrieve_thoughts to find the id, then delete_thought with that thought_id (soft archive — same family as mark done).',
  '- Never claim an edit/delete succeeded unless the tool succeeded in this turn.',
  '- If a tool errors, explain in your final answer.',
  '- Output ONLY the JSON object.',
].join('\n')

type AgentResponse =
  | {
      type: 'tool_call'
      tool: string
      arguments: Record<string, unknown>
      thinking: string
    }
  | {
      type: 'final'
      content: string
      thinking: string
    }
  | {
      type: 'parse_error'
      reason: string
      thinking: string
    }

/** Strips a leading <think>...</think> block from the raw LLM output. */
function extractThinking(raw: string): { thinking: string; rest: string } {
  const match = raw.match(/^<think>([\s\S]*?)<\/think>\s*/i)
  if (match) {
    return { thinking: match[1].trim(), rest: raw.slice(match[0].length).trim() }
  }
  return { thinking: '', rest: raw }
}

function parseResponse(text: string): AgentResponse {
  const { thinking, rest } = extractThinking(text)
  let trimmed = rest.trim()

  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)```\s*$/)
  if (fenceMatch) {
    trimmed = fenceMatch[1].trim()
  }

  trimmed = trimmed.replace(/```[\s\S]*$/, '').trim()

  function tryParseJson(str: string): unknown {
    try {
      return JSON.parse(str)
    } catch {
      return undefined
    }
  }

  let parsed: unknown = tryParseJson(trimmed)

  if (!parsed) {
    const firstBrace = trimmed.indexOf('{')
    if (firstBrace >= 0) {
      let depth = 0
      for (let i = firstBrace; i < trimmed.length; i++) {
        if (trimmed[i] === '{') depth++
        else if (trimmed[i] === '}') {
          depth--
          if (depth === 0) {
            parsed = tryParseJson(trimmed.slice(firstBrace, i + 1))
            if (parsed) break
          }
        }
      }
    }
  }

  if (!parsed) {
    console.error('[agent-loop] LLM response is not valid JSON', {
      preview: trimmed.slice(0, 300),
    })
    return {
      type: 'parse_error',
      reason: 'The model response was not valid JSON.',
      thinking,
    }
  }

  if (typeof parsed !== 'object' || !parsed) {
    console.error('[agent-loop] LLM response is not a JSON object', { parsed })
    return {
      type: 'parse_error',
      reason: 'The model response was not a JSON object.',
      thinking,
    }
  }

  const obj = parsed as Record<string, unknown>

  if (typeof obj.tool === 'string' && obj.arguments && typeof obj.arguments === 'object') {
    console.error('[agent-loop] parsed tool_call', { tool: obj.tool, arguments: obj.arguments })
    return {
      type: 'tool_call',
      tool: obj.tool,
      arguments: obj.arguments as Record<string, unknown>,
      thinking,
    }
  }

  if (typeof obj.answer === 'string') {
    console.error('[agent-loop] parsed final answer', { preview: obj.answer.slice(0, 80) })
    return { type: 'final', content: obj.answer, thinking }
  }

  console.error('[agent-loop] JSON object has neither "tool" nor "answer" key', {
    keys: Object.keys(obj),
    preview: trimmed.slice(0, 300),
  })
  return {
    type: 'parse_error',
    reason: 'The model JSON must include either a "tool" or an "answer" field.',
    thinking,
  }
}

export type AgentChatResult = {
  response: string
  messages: ChatMessage[]
}

type ToolExecutionContext = {
  userId: string
  ctx: McpToolContext
  onEvent?: (event: ChatStreamEvent) => void
  db?: ReturnType<typeof getDb>
  assistantContentForHistory?: string
}

function normalizeAgentToolArgs(
  tool: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (tool !== 'delete_thought' && tool !== 'edit_thought') return args
  try {
    const thoughtId = readThoughtIdFromToolArgs(args)
    return { ...args, thought_id: thoughtId }
  } catch {
    return args
  }
}

async function executeAgentToolCall(input: {
  tool: string
  arguments: Record<string, unknown>
  exec: ToolExecutionContext
}): Promise<
  | { done: true; response: string }
  | { done: false; result: unknown; assistantContent: string }
> {
  const { tool, exec } = input
  const args = normalizeAgentToolArgs(tool, input.arguments)

  const handler = MCP_TOOL_MAP.get(tool)
  const allowed = isAgentTool(tool)
  if (!handler || !allowed) {
    return {
      done: false,
      result: {
        error: `Tool "${tool}" is not available. Available: ${MCP_AGENT_TOOL_NAMES.join(', ')}`,
      },
      assistantContent: JSON.stringify({ tool, arguments: args }),
    }
  }

  exec.onEvent?.({ type: 'tool_call', tool, arguments: args })
  console.info('[agent-loop] tool start', { tool, arguments: args })
  exec.onEvent?.({ type: 'tool_executing', tool })

  const toolStart = Date.now()
  let result: unknown
  try {
    result = sanitizeMcpToolResult(await handler(exec.ctx, args))

    const preview = formatToolResultPreview(tool, result)
    exec.onEvent?.({ type: 'tool_result', tool, preview })
    console.info('[agent-loop] tool done', {
      tool,
      durationMs: Date.now() - toolStart,
      result: formatToolResultPreview(tool, redactForLog(result)),
    })
    await logActivityCall(exec.db ?? getDb(), exec.userId, {
      provider: AGENT_TOOL_ACTIVITY_PROVIDER,
      operation: `tool_call.${tool}`,
      baseCostUsd: 0,
      context: Object.entries(args)
        .map(([k, v]) => `${k}: ${JSON.stringify(v).slice(0, 30)}`)
        .join(', '),
      durationMs: Date.now() - toolStart,
    })

    if (
      tool === 'answer_question' &&
      result &&
      typeof result === 'object' &&
      'answer' in result &&
      typeof (result as ComposedAnswer).answer === 'string'
    ) {
      return {
        done: true,
        response: formatComposedAnswerForUser((result as ComposedAnswer).answer),
      }
    }
  } catch (err) {
    console.error('[agent-loop] tool error', {
      tool,
      error: err instanceof Error ? err.message : String(err),
    })
    result = { error: err instanceof Error ? err.message : String(err) }
    const errorMessage = err instanceof Error ? err.message : String(err)
    const errorPreview = formatToolResultPreview(tool, result)
    exec.onEvent?.({ type: 'tool_result', tool, preview: errorPreview, failed: true })
    await logActivityCall(exec.db ?? getDb(), exec.userId, {
      provider: AGENT_TOOL_ACTIVITY_PROVIDER,
      operation: `tool_error.${tool}`,
      baseCostUsd: 0,
      context: Object.entries(args)
        .map(([k, v]) => `${k}: ${JSON.stringify(v).slice(0, 30)}`)
        .join(', '),
      errorMessage,
      durationMs: Date.now() - toolStart,
    })
  }

  return {
    done: false,
    result,
    assistantContent: exec.assistantContentForHistory ?? JSON.stringify({ tool, arguments: args }),
  }
}

export async function agentChat(input: {
  userId: string
  messages: ChatMessage[]
  onEvent?: (event: ChatStreamEvent) => void
  db?: ReturnType<typeof getDb>
  mode?: ChatSessionMode
}): Promise<AgentChatResult> {
  const ctx: McpToolContext = {
    userId: input.userId,
    onToolProgress: (event) => {
      input.onEvent?.({
        type: 'tool_progress',
        tool: event.tool,
        phase: event.phase,
        label: event.label,
      })
    },
  }

  const exec: ToolExecutionContext = {
    userId: input.userId,
    ctx,
    onEvent: input.onEvent,
    db: input.db,
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: AGENT_SYSTEM_PROMPT },
    ...input.messages,
  ]
  let parseFailureCount = 0
  let toolRanInTurn = false
  let answerQuestionRan = false
  let writeToolRan = false
  let retrieveSearchRan = false

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    console.error('[agent-loop] iteration', { iteration, messageCount: messages.length })

    input.onEvent?.({
      type: 'agent_progress',
      label: iteration === 0 ? 'Planning next step…' : 'Preparing your reply…',
    })
    const llmStart = Date.now()
    console.info('[agent-loop] llm request start', {
      iteration,
      messageCount: messages.length,
      promptChars: messages.reduce((n, m) => n + m.content.length, 0),
    })
    for (const message of messages) {
      console.log(`[agent-loop] prompt ${message.role}:\n${message.content}`)
    }
    const raw = await llmChatCompletion({
      userId: input.userId,
      messages,
      temperature: 0,
      logContext: `agent_iter_${iteration}`,
    })
    console.info('[agent-loop] llm request done', { iteration, durationMs: Date.now() - llmStart })

    const response = raw as { choices?: Array<{ message?: { content?: string } }> }
    const content = response?.choices?.[0]?.message?.content?.trim() ?? ''

    if (!content) {
      console.error('[agent-loop] LLM returned empty content')
      return { response: 'The assistant did not produce a response.', messages }
    }

    console.error('[agent-loop] LLM raw response', { preview: content.slice(0, 300) })
    const parsed = parseResponse(content)

    if (parsed.thinking) {
      input.onEvent?.({ type: 'thinking', content: parsed.thinking })
    }

    if (parsed.type === 'parse_error') {
      parseFailureCount += 1
      if (parseFailureCount >= MAX_PARSE_RETRIES) {
        throw new AgentParseError(parsed.reason)
      }
      messages.push({ role: 'assistant', content })
      messages.push({
        role: 'user',
        content: `Error: ${parsed.reason} Respond with valid JSON only — either {"tool": "<tool_name>", "arguments": {...}} or {"answer": "<your response>"}.`,
      })
      continue
    }

    if (parsed.type === 'tool_call') {
      const handler = MCP_TOOL_MAP.get(parsed.tool)
      if (!handler || !isAgentTool(parsed.tool)) {
        console.error('[agent-loop] unknown tool requested', { tool: parsed.tool })
        messages.push({ role: 'assistant', content })
        messages.push({
          role: 'user',
          content: formatUnknownToolError(parsed.tool),
        })
        continue
      }

      const outcome = await executeAgentToolCall({
        tool: parsed.tool,
        arguments: parsed.arguments,
        exec: { ...exec, assistantContentForHistory: content },
      })

      toolRanInTurn = true
      parseFailureCount = 0
      if (parsed.tool === 'answer_question') answerQuestionRan = true
      if (AGENT_WRITE_TOOLS.has(parsed.tool)) writeToolRan = true
      if (isRetrieveThoughtsSearch(parsed.tool, parsed.arguments)) retrieveSearchRan = true

      if (outcome.done) {
        messages.push({ role: 'assistant', content })
        messages.push({ role: 'assistant', content: outcome.response })
        return { response: outcome.response, messages }
      }

      const followUpHint = isRetrieveThoughtsSearch(parsed.tool, parsed.arguments)
        ? 'retrieve_thoughts search results are for finding ids or browsing — do not compose a memory answer from them. For any question, call answer_question next.'
        : 'If more tools are needed, call one now. Otherwise give your final answer using {"answer": "<your response>"}.'

      messages.push({ role: 'assistant', content })
      messages.push({
        role: 'user',
        content: `Tool result for ${parsed.tool}:\n${formatToolResultForAgentMessage(parsed.tool, outcome.result)}\n\n${followUpHint}`,
      })
      continue
    }

    if (!toolRanInTurn) {
      parseFailureCount += 1
      if (parseFailureCount >= MAX_PARSE_RETRIES) {
        throw new AgentParseError('The assistant tried to answer without calling a tool.')
      }
      messages.push({ role: 'assistant', content })
      messages.push({
        role: 'user',
        content:
          'Error: You must call a tool before answering. For any question, including about yourself, call answer_question. Never answer from your own knowledge. Respond with {"tool": ...} only.',
      })
      continue
    }

    if (retrieveSearchRan && !answerQuestionRan && !writeToolRan) {
      parseFailureCount += 1
      if (parseFailureCount >= MAX_PARSE_RETRIES) {
        throw new AgentParseError(
          'The assistant tried to answer from retrieve_thoughts search results without calling answer_question.',
        )
      }
      messages.push({ role: 'assistant', content })
      messages.push({
        role: 'user',
        content:
          'Error: You used retrieve_thoughts with a search query, which is for browsing/finding ids — not for answering questions. Call answer_question with the user question now. Respond with {"tool": "answer_question", "arguments": {"question": "..."}} only.',
      })
      continue
    }

    if (isUnpresentableFinalAnswer(parsed.content)) {
      parseFailureCount += 1
      if (parseFailureCount >= MAX_PARSE_RETRIES) {
        throw new AgentParseError(
          'The assistant returned unreadable data instead of a natural-language answer.',
        )
      }
      messages.push({ role: 'assistant', content })
      messages.push({
        role: 'user',
        content:
          'Error: Your last response was not valid user-facing text. Reply with {"answer": "<natural language answer for the user>"} only.',
      })
      continue
    }

    messages.push({ role: 'assistant', content })
    return { response: parsed.content, messages }
  }

  console.error('[agent-loop] max iterations reached')
  return {
    response: 'The assistant took too many steps to answer. Please try rephrasing your question.',
    messages,
  }
}
