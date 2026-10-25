import { error } from '@sveltejs/kit'
import { asc, eq, sql } from 'drizzle-orm'
import { formatToolResultForDisplay, sanitizeFinalAnswerText } from '$lib/chat/chat-stream-types'
import type { ChatStreamEvent } from '$lib/chat/chat-stream-types'
import { compactChatIntermediateSteps } from '$lib/chat/normalize-messages'
import { runWithTrace } from '$lib/server/activity/trace-context'
import { sessionMessagesToAgentHistory } from '$lib/server/chat/session-history-for-agent'
import type { getDb } from '$lib/server/db'
import { chatSession, chatMessage, type ChatSessionMode } from '$lib/server/db/brain.schema'
import { agentChat } from '$lib/server/llm/agent-loop'
import type { ChatMessage } from '$lib/server/llm/llm-client'

type AskDb = ReturnType<typeof getDb>

export type IntermediateStep = { content: string; metadata: Record<string, unknown> }

export async function getOrCreateSession(
  db: AskDb,
  userId: string,
  sessionId: string | null,
  mode: ChatSessionMode,
): Promise<{ sessionId: string; mode: ChatSessionMode }> {
  if (!sessionId) {
    const [s] = await db
      .insert(chatSession)
      .values({
        userId,
        mode,
        title: '',
      })
      .returning({ id: chatSession.id, mode: chatSession.mode })
    return { sessionId: s.id, mode: s.mode }
  }
  const [existing] = await db
    .select({ id: chatSession.id, mode: chatSession.mode })
    .from(chatSession)
    .where(eq(chatSession.id, sessionId))
    .limit(1)
  if (!existing) error(404, 'Session not found')
  if (existing.mode !== mode) {
    error(400, `Session mode mismatch: expected ${mode}`)
  }
  return { sessionId, mode: existing.mode }
}

export async function persistAssistantMessage(
  db: AskDb,
  sessionId: string,
  userId: string,
  content: string,
  metadata?: Record<string, unknown> | null,
) {
  const [msg] = await db
    .insert(chatMessage)
    .values({ sessionId, userId, role: 'assistant', content, ...(metadata ? { metadata } : {}) })
    .returning({ id: chatMessage.id })
  return msg.id
}

/**
 * Persist a completed streamed turn in live-UI order: compacted tool/thinking steps,
 * then the final assistant text. Callers should emit `done` after this returns.
 */
export async function persistStreamedAssistantTurn(input: {
  db: AskDb
  sessionId: string
  userId: string
  responseText: string
  intermediateSteps: IntermediateStep[]
}): Promise<{ messageId: string; storedStepCount: number }> {
  const storedSteps = compactChatIntermediateSteps(input.intermediateSteps)
  for (const step of storedSteps) {
    await input.db.insert(chatMessage).values({
      sessionId: input.sessionId,
      userId: input.userId,
      role: 'assistant',
      content: step.content,
      metadata: step.metadata,
    })
  }
  const messageId = await persistAssistantMessage(
    input.db,
    input.sessionId,
    input.userId,
    input.responseText,
  )
  return { messageId, storedStepCount: storedSteps.length }
}

/** The persisted form of one agent stream event, or null when the event is not stored. */
export function intermediateStepFromEvent(evt: ChatStreamEvent): IntermediateStep | null {
  if (evt.type === 'thinking' && evt.content) {
    return { content: evt.content, metadata: { variant: 'thinking' } }
  }
  if (evt.type === 'tool_call') {
    return {
      content: JSON.stringify({ tool: evt.tool, arguments: evt.arguments }),
      metadata: { variant: 'tool_call', tool: evt.tool, arguments: evt.arguments },
    }
  }
  if (evt.type === 'tool_executing') {
    return { content: evt.tool, metadata: { variant: 'tool_executing', tool: evt.tool } }
  }
  if (evt.type === 'tool_progress') {
    return {
      content: evt.label,
      metadata: {
        variant: 'tool_progress',
        tool: evt.tool,
        phase: evt.phase,
        label: evt.label,
      },
    }
  }
  if (evt.type === 'tool_result') {
    return {
      content: evt.preview,
      metadata: {
        variant: 'tool_result',
        tool: evt.tool,
        failed: evt.failed === true,
        displaySummary: formatToolResultForDisplay(evt.tool, evt.preview),
      },
    }
  }
  return null
}

/** The user-facing answer text of a finished agent run (steps supply the answer_question preview). */
export function finalAnswerText(agentResponse: unknown, steps: IntermediateStep[]): string {
  let lastAnswerQuestionPreview: string | undefined
  for (const step of steps) {
    if (step.metadata.variant === 'tool_result' && step.metadata.tool === 'answer_question') {
      lastAnswerQuestionPreview = step.content
    }
  }
  const rawResponse =
    typeof agentResponse === 'string' && agentResponse.trim().length > 0
      ? agentResponse
      : 'The assistant did not produce a response.'
  return sanitizeFinalAnswerText(rawResponse, lastAnswerQuestionPreview)
}

/**
 * Start of an Ask turn: read the session's prior turns (so history excludes this turn),
 * then store the user's message. A bootstrap prompt is system-made and is not stored.
 */
export async function beginAskTurn(
  db: AskDb,
  input: { userId: string; sessionId: string; message: string; bootstrap: boolean },
): Promise<{ history: ChatMessage[]; isFirstMessage: boolean }> {
  const priorRows = await db
    .select({
      role: chatMessage.role,
      content: chatMessage.content,
      metadata: chatMessage.metadata,
    })
    .from(chatMessage)
    .where(eq(chatMessage.sessionId, input.sessionId))
    .orderBy(asc(chatMessage.createdAt))
  const history = sessionMessagesToAgentHistory(
    priorRows.map((row) => ({
      role: row.role,
      content: row.content,
      metadata:
        row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : null,
    })),
  )

  if (!input.bootstrap) {
    await db.insert(chatMessage).values({
      sessionId: input.sessionId,
      userId: input.userId,
      role: 'user',
      content: input.message,
    })
  }

  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chatMessage)
    .where(eq(chatMessage.sessionId, input.sessionId))
  return { history, isFirstMessage: input.bootstrap || countResult[0]?.count === 1 }
}

export async function titleSessionFromMessage(
  db: AskDb,
  sessionId: string,
  message: string,
): Promise<void> {
  const title = message.length > 80 ? message.slice(0, 77) + '...' : message
  await db.update(chatSession).set({ title }).where(eq(chatSession.id, sessionId))
}

export type AskToolCall = {
  tool: string
  arguments: Record<string, unknown>
  failed: boolean
}

export type RunAskTurnResult = {
  answer: string
  toolCalls: AskToolCall[]
  messageId: string
  /** The agent loop's messages for this turn (system prompt included). */
  messages: ChatMessage[]
}

/**
 * One whole Ask turn without HTTP: store the user message, run the agent on the session
 * history plus the message, store the answer. `/api/chat` (JSON mode) and the eval harness
 * both call it; the streaming route keeps its own shell (reserved connection, ndjson
 * events) and shares only the helpers above.
 *
 * `bootstrap`: `message` is a system-made prompt (briefing) — sent to the agent, never
 * stored as a user message, never a session title. `persistSteps`: also store the compacted
 * tool/thinking steps before the answer, as the streaming UI does.
 */
export async function runAskTurn(input: {
  db: AskDb
  userId: string
  sessionId: string
  message: string
  mode?: ChatSessionMode
  bootstrap?: boolean
  persistSteps?: boolean
  onEvent?: (event: ChatStreamEvent) => void
}): Promise<RunAskTurnResult> {
  const message = input.message.trim()
  if (!message) throw new Error('runAskTurn: message is required')
  const bootstrap = input.bootstrap === true

  const { history, isFirstMessage } = await beginAskTurn(input.db, {
    userId: input.userId,
    sessionId: input.sessionId,
    message,
    bootstrap,
  })

  const steps: IntermediateStep[] = []
  const toolCalls: AskToolCall[] = []
  const result = await runWithTrace(crypto.randomUUID(), () =>
    agentChat({
      userId: input.userId,
      messages: [...history, { role: 'user', content: message }],
      mode: input.mode ?? 'default',
      aiSessionId: input.sessionId,
      db: input.db,
      onEvent: (evt) => {
        const step = intermediateStepFromEvent(evt)
        if (step) steps.push(step)
        if (evt.type === 'tool_call') {
          toolCalls.push({ tool: evt.tool, arguments: evt.arguments, failed: false })
        } else if (evt.type === 'tool_result' && evt.failed === true) {
          const call = toolCalls.at(-1)
          if (call) call.failed = true
        }
        input.onEvent?.(evt)
      },
    }),
  )

  const answer = finalAnswerText(result.response, steps)
  const { messageId } = await persistStreamedAssistantTurn({
    db: input.db,
    sessionId: input.sessionId,
    userId: input.userId,
    responseText: answer,
    intermediateSteps: input.persistSteps === true ? steps : [],
  })

  if (isFirstMessage && !bootstrap) {
    await titleSessionFromMessage(input.db, input.sessionId, message)
  }

  return { answer, toolCalls, messageId, messages: result.messages }
}
