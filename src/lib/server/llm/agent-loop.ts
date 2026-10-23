import { randomUUID } from 'node:crypto'
import type { ChatStreamEvent } from '$lib/chat/chat-stream-types'
import { isUnpresentableFinalAnswer } from '$lib/chat/chat-stream-types'
import { AGENT_TOOL_ACTIVITY_PROVIDER } from '$lib/server/activity/gateway-providers'
import { logActivityCall } from '$lib/server/activity/log-call'
import { captureServerEvent } from '$lib/server/analytics/posthog-server'
import { getDb } from '$lib/server/db'
import type { ChatSessionMode } from '$lib/server/db/brain.schema'
import {
  formatToolResultForAgentMessage,
  formatToolResultPreview,
} from '$lib/server/llm/agent-tool-result-compact'
import { resolveDecisionEnforceKinds } from '$lib/server/llm/decision-client'
import { runEnforcedBoundedDecisions } from '$lib/server/llm/decision-plane'
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client'
import {
  buildChatAgentToolDescriptionBlock,
  CHAT_AGENT_TOOL_NAMES,
  isChatAgentTool,
  MCP_TOOL_MAP,
} from '$lib/server/mcp/registry'
import type { McpToolContext } from '$lib/server/mcp/tools'
import { redactForLog } from '$lib/server/observability/redact-for-log'
import { sanitizeMcpToolResult } from '$lib/server/observability/strip-embeddings'
import { formatComposedAnswerForUser, type ComposedAnswer } from '$lib/server/qa/compose-answer'
import { readThoughtIdFromToolArgs } from '$lib/server/validation/mcp-args'

const MAX_ITERATIONS = 8
const MAX_PARSE_RETRIES = 3

/** Mutation / write tools — a final answer after these does not require answer_question.
 *  capture_thought is deliberately absent: the ask surface never stores new thoughts. */
const AGENT_WRITE_TOOLS = new Set([
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
  capture_thought:
    'capture_thought is not available here — Ask is ask-only and never stores new thoughts (capturing happens on the Capture page). For any question call answer_question; for notes use the text-file tools.',
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
  const available = `Available tools: ${CHAT_AGENT_TOOL_NAMES.join(', ')}`
  const hint = REMOVED_TOOL_HINTS[tool]
  if (hint) {
    return `Error: tool "${tool}" is not available. ${hint} ${available}`
  }
  return `Error: tool "${tool}" is not available. ${available}`
}

const TOOL_DESCRIPTION_BLOCK = buildChatAgentToolDescriptionBlock()

/**
 * Thin chat agent: ask-only MCP thought tools plus chat-only text-note tools, with streaming visual feedback.
 * No router or classifiers. The ask surface never captures: capture_thought is not in the
 * loop's toolset (CHAT_AGENT_TOOL_NAMES), so nothing typed into Ask is stored as a new
 * thought — a stray capture call is rejected with a steering hint and the turn answers instead.
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
  "- This surface is ask-only: the user asks questions here and capture is not available. Never store the user's message or anything from this turn as a new thought. If the user wants something remembered, tell them capturing happens on the Capture page; still call answer_question for any question.",
  '- Notes tab documents (shopping lists, titled notes, notebooks, checklists) are text notes — create and edit them with the text-file tools. They are not memory thoughts.',
  '- Create a NEW note/list only: create_text_file with title and/or body (title-only is fine for an empty new list). Use create only when the user wants a fresh document, not when amending one that already exists.',
  '- Add / append / change content on a referenced note (e.g. "add milk to my shopping list"): search_text_files or list_text_files to find text_file_id, then append_text_file (or get_text_file + update_text_file for a full rewrite). Never create_text_file for additive requests on an existing named note/list.',
  '- Edit / rewrite a note title or full body: list_text_files or search_text_files to find text_file_id, then update_text_file.',
  '- Delete a note: list_text_files or search_text_files to find text_file_id, then delete_text_file.',
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
  aiSessionId?: string
  aiTraceId?: string
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
  { done: true; response: string } | { done: false; result: unknown; assistantContent: string }
> {
  const { tool, exec } = input
  const args = normalizeAgentToolArgs(tool, input.arguments)

  const handler = MCP_TOOL_MAP.get(tool)
  const allowed = isChatAgentTool(tool)
  if (!handler || !allowed) {
    return {
      done: false,
      result: {
        error: `Tool "${tool}" is not available. Available: ${CHAT_AGENT_TOOL_NAMES.join(', ')}`,
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
    captureServerEvent({
      distinctId: exec.userId,
      event: '$ai_span',
      properties: {
        $ai_trace_id: exec.aiTraceId,
        $ai_session_id: exec.aiSessionId,
        $ai_span_name: tool,
        $ai_latency: (Date.now() - toolStart) / 1000,
      },
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
    captureServerEvent({
      distinctId: exec.userId,
      event: '$ai_span',
      properties: {
        $ai_trace_id: exec.aiTraceId,
        $ai_session_id: exec.aiSessionId,
        $ai_span_name: tool,
        $ai_latency: (Date.now() - toolStart) / 1000,
        $ai_is_error: true,
      },
    })
  }

  return {
    done: false,
    result,
    assistantContent: exec.assistantContentForHistory ?? JSON.stringify({ tool, arguments: args }),
  }
}

/** The closed intent catalog the decision model classifies each chat turn into. */
const MESSAGE_INTENT_CRITERIA = {
  memory_question: 'Asks about stored memories or facts ("what do I know about…").',
  capture_new: 'Wants to store/save new information.',
  edit_stored: 'Wants to change or correct something already stored.',
  note_operation: 'Note/list operations (complete, archive, reschedule a note or event).',
  project_operation: 'GTD project operations (status, plan, tasks of a project).',
  smalltalk: 'Greeting, thanks, or meta-chat about the assistant.',
} as const

/**
 * Advisory per-turn intent classification (DECISION_ENFORCE_KINDS=message_intent,
 * surface chat_turn): ONE Decisions call for the user message entering the
 * loop, consumed as a soft `[detected intent: <choice>]` hint line appended to
 * the system context the loop model sees.
 *
 * This call site deliberately deviates from the enforced fail-loud contract:
 * message_intent is a NEW advisory signal, not a replacement of an existing
 * enforced decision — no downstream consumer holds a chat-judge primary for
 * it, and the hint only nudges tool routing. Chat availability outranks
 * intent quality, so a classification failure degrades to "no hint" instead
 * of throwing into the user's turn. The enforcement gate itself stays outside
 * the try/catch (same posture as every other consumer): an unknown
 * DECISION_ENFORCE_KINDS entry still fails loud at config resolution.
 */
async function detectMessageIntentHint(userId: string, state: string): Promise<string | null> {
  if (!resolveDecisionEnforceKinds().has('message_intent')) return null
  try {
    const answers = await runEnforcedBoundedDecisions({
      userId,
      surface: 'chat_turn',
      state,
      specs: [
        {
          decisionKind: 'message_intent',
          id: 'intent',
          question: {
            type: 'choice',
            instructions: 'What does the user want in this chat turn?',
            criteria: MESSAGE_INTENT_CRITERIA,
          },
          llmChoice: null,
        },
      ],
    })
    const answer = answers.get('intent')
    return answer ? `[detected intent: ${answer.choice}]` : null
  } catch (err) {
    console.error('[message-intent] classification failed', err)
    return null
  }
}

/**
 * The current turn's user message: agentChat receives [...history, newMessage],
 * so the LAST user entry is the message entering the loop this turn (history
 * may contain synthetic "Tool result for …" user messages from prior tool
 * steps — never the caller's message). Follow-up messages of the same
 * conversation enter the loop as the last user entry of their own turn and
 * are classified then. Returns null without a call when there is no
 * non-blank user message (no turn text to classify).
 */
function currentUserMessageText(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      const text = messages[i].content.trim()
      return text.length > 0 ? text : null
    }
  }
  return null
}

export async function agentChat(input: {
  userId: string
  messages: ChatMessage[]
  onEvent?: (event: ChatStreamEvent) => void
  db?: ReturnType<typeof getDb>
  mode?: ChatSessionMode
  aiSessionId?: string
}): Promise<AgentChatResult> {
  const aiTraceId = randomUUID()
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
    aiSessionId: input.aiSessionId,
    aiTraceId,
  }

  // Advisory intent hint (zero calls, byte-identical loop when message_intent
  // is not enforced) — must resolve before the first model call so the hint is
  // part of the context that call sees.
  const turnUserMessage = currentUserMessageText(input.messages)
  const intentHint = turnUserMessage
    ? await detectMessageIntentHint(input.userId, turnUserMessage)
    : null

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: intentHint ? `${AGENT_SYSTEM_PROMPT}\n${intentHint}` : AGENT_SYSTEM_PROMPT,
    },
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
      aiSessionId: input.aiSessionId,
      aiTraceId,
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
      if (!handler || !isChatAgentTool(parsed.tool)) {
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
