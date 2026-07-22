import { error, json } from '@sveltejs/kit'
import type { RequestEvent } from '@sveltejs/kit'
import { formatToolResultForDisplay, sanitizeFinalAnswerText } from '$lib/chat/chat-stream-types'
import { compactChatIntermediateSteps } from '$lib/chat/normalize-messages'
import { agentChat } from '$lib/server/llm/agent-loop'
import { tenantUserAsyncLocal } from '$lib/server/billing/context'
import {
  appDbAsyncLocal,
  appSql,
  createScopedDrizzle,
  getDb,
  activateTenantDbSession,
  deactivateTenantDbSession,
} from '$lib/server/db'
import { chatSession, chatMessage, type ChatSessionMode } from '$lib/server/db/brain.schema'
import { asc, eq, sql } from 'drizzle-orm'
import { runWithTrace } from '$lib/server/activity/trace-context'
import {
  insufficientCreditsPayload,
  isInsufficientCreditsError,
} from '$lib/server/billing/insufficient-credits'
import { sessionMessagesToAgentHistory } from '$lib/server/chat/session-history-for-agent'

function collectErrorMessages(input: unknown): string[] {
  const parts: string[] = []
  let current = input
  let guard = 0
  while (current && guard < 8) {
    guard += 1
    if (current instanceof Error) {
      parts.push(current.message)
      current = current.cause
      continue
    }
    if (typeof current === 'object' && current) {
      const msg = 'message' in current ? (current as { message?: unknown }).message : undefined
      if (typeof msg === 'string' && msg.trim().length > 0) {
        parts.push(msg)
      }
      current = 'cause' in current ? (current as { cause?: unknown }).cause : undefined
      continue
    }
    break
  }
  return parts.filter((v, i, arr) => v && arr.indexOf(v) === i)
}

export function chatErrorTerminalPayload(
  err: unknown,
  details: string[],
): { type: 'error'; error: string; details?: string[]; [key: string]: unknown } {
  const msg = details[0] ?? 'An unexpected error occurred.'
  if (isInsufficientCreditsError(err)) {
    return { type: 'error', ...insufficientCreditsPayload(err), details }
  }
  return { type: 'error', error: msg, details }
}

export const BRIEFING_BOOTSTRAP_MESSAGES: Record<string, string> = {
  morning:
    "Give my morning briefing: today's agenda, top 3 priorities, and open loops. Use list_temporal_events and retrieve_thoughts. Be calm and concise.",
  evening:
    'Give my evening review: what was completed today, what rolls over, and gentle suggestions for tomorrow. Use list_temporal_events.',
  weekly:
    'Give my weekly review: completions this week, overdue debt, patterns, and 2–3 focus suggestions for next week. Use list_temporal_events and retrieve_thoughts.',
}

async function getOrCreateSession(
  db: ReturnType<typeof getDb>,
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

async function persistAssistantMessage(
  db: ReturnType<typeof getDb>,
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
  db: ReturnType<typeof getDb>
  sessionId: string
  userId: string
  responseText: string
  intermediateSteps: Array<{ content: string; metadata: Record<string, unknown> }>
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

export type AgentChatPostBody = {
  message?: unknown
  history?: unknown
  sessionId?: unknown
  mode?: unknown
  bootstrap?: unknown
  briefingPeriod?: unknown
}

export type HandleAgentChatPostOptions = {
  /** Fixed session mode for this endpoint. */
  sessionMode: ChatSessionMode
  /** Resolve the user message sent to the agent (bootstrap or typed). */
  resolveAgentUserMessage: (input: {
    bootstrap: boolean
    message: string
    briefingPeriod: string
  }) => string
  logTag?: string
}

export async function handleAgentChatPost(
  event: RequestEvent,
  body: AgentChatPostBody,
  options: HandleAgentChatPostOptions,
) {
  const user = event.locals.user
  if (!user) {
    console.error(`[${options.logTag ?? 'api/chat'}] no user`)
    error(401, 'Unauthorized')
  }

  const bootstrap = body.bootstrap === true
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  const briefingPeriod = typeof body.briefingPeriod === 'string' ? body.briefingPeriod.trim() : ''

  if (!message && !bootstrap) {
    console.error(`[${options.logTag ?? 'api/chat'}] empty message`)
    error(400, 'message is required')
  }

  const agentUserMessage = options.resolveAgentUserMessage({ bootstrap, message, briefingPeriod })

  const db = getDb()
  const sessionKey =
    typeof body.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : null
  const { sessionId, mode: sessionMode } = await getOrCreateSession(
    db,
    user.id,
    sessionKey,
    options.sessionMode,
  )

  // Load prior turns before inserting this user message so history excludes the current turn.
  const priorRows = await db
    .select({
      role: chatMessage.role,
      content: chatMessage.content,
      metadata: chatMessage.metadata,
    })
    .from(chatMessage)
    .where(eq(chatMessage.sessionId, sessionId))
    .orderBy(asc(chatMessage.createdAt))
  const history = sessionMessagesToAgentHistory(priorRows)

  if (!bootstrap) {
    await db.insert(chatMessage).values({
      sessionId,
      userId: user.id,
      role: 'user',
      content: message,
    })
  }

  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chatMessage)
    .where(eq(chatMessage.sessionId, sessionId))
  const isFirstMessage = bootstrap || countResult[0]?.count === 1

  const accept = event.request.headers?.get('accept') ?? ''
  const streamNdjson = accept.includes('application/x-ndjson')

  if (streamNdjson) {
    const encoder = new TextEncoder()
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>(
      {},
      { highWaterMark: 64 },
    )
    const writer = writable.getWriter()

    let terminalSent = false
    let streamClosed = false

    const writeLine = (payload: unknown) => {
      if (streamClosed) return
      void writer.write(encoder.encode(`${JSON.stringify(payload)}\n`)).catch(() => {
        streamClosed = true
      })
    }

    const sendTerminal = (payload: { type: 'done' | 'error'; [key: string]: unknown }) => {
      if (terminalSent) return
      terminalSent = true
      writeLine(payload)
    }

    const closeStream = async () => {
      if (streamClosed) return
      streamClosed = true
      await writer.close().catch(() => {})
    }

    event.request.signal.addEventListener('abort', () => {
      if (!terminalSent) {
        sendTerminal({
          type: 'error',
          error: 'Request cancelled.',
          details: ['client disconnected'],
        })
      }
      streamClosed = true
      void writer.abort(new Error('client disconnected')).catch(() => {})
    })

    const intermediateSteps: Array<{ content: string; metadata: Record<string, unknown> }> = []

    const recordIntermediateStep = (evt: {
      type: string
      content?: string
      tool?: string
      arguments?: Record<string, unknown>
      preview?: string
      failed?: boolean
      phase?: string
      label?: string
    }) => {
      if (evt.type === 'thinking' && evt.content) {
        intermediateSteps.push({
          content: evt.content,
          metadata: { variant: 'thinking' },
        })
      } else if (evt.type === 'tool_call') {
        const args = evt.arguments ?? {}
        intermediateSteps.push({
          content: JSON.stringify({ tool: evt.tool, arguments: args }),
          metadata: { variant: 'tool_call', tool: evt.tool, arguments: args },
        })
      } else if (evt.type === 'tool_executing') {
        intermediateSteps.push({
          content: evt.tool ?? '',
          metadata: { variant: 'tool_executing', tool: evt.tool },
        })
      } else if (evt.type === 'tool_progress') {
        intermediateSteps.push({
          content: evt.label ?? '',
          metadata: {
            variant: 'tool_progress',
            tool: evt.tool,
            phase: evt.phase,
            label: evt.label,
          },
        })
      } else if (evt.type === 'tool_result') {
        const preview = evt.preview ?? ''
        const failed = evt.failed === true
        intermediateSteps.push({
          content: preview,
          metadata: {
            variant: 'tool_result',
            tool: evt.tool,
            failed,
            displaySummary: formatToolResultForDisplay(evt.tool ?? '', preview),
          },
        })
      }
    }

    const chatWork = (async () => {
      let reserved: Awaited<ReturnType<typeof appSql.reserve>> | null = null
      try {
        reserved = await appSql.reserve()
        await activateTenantDbSession(reserved, user.id)
        const scopedDb = createScopedDrizzle(reserved)

        const result = await tenantUserAsyncLocal.run(user.id, () =>
          appDbAsyncLocal.run(scopedDb, () =>
            runWithTrace(crypto.randomUUID(), () =>
              agentChat({
                userId: user.id,
                messages: [...history, { role: 'user', content: agentUserMessage }],
                mode: sessionMode,
                onEvent: (evt) => {
                  if (!streamClosed) {
                    writeLine(evt)
                  }
                  recordIntermediateStep(evt)
                },
                db: scopedDb,
              }),
            ),
          ),
        )

        let lastAnswerQuestionPreview: string | undefined
        for (const step of intermediateSteps) {
          if (step.metadata.variant === 'tool_result' && step.metadata.tool === 'answer_question') {
            lastAnswerQuestionPreview = step.content
          }
        }
        const rawResponse =
          typeof result.response === 'string' && result.response.trim().length > 0
            ? result.response
            : 'The assistant did not produce a response.'
        const responseText = sanitizeFinalAnswerText(rawResponse, lastAnswerQuestionPreview)
        const { messageId } = await persistStreamedAssistantTurn({
          db: scopedDb,
          sessionId,
          userId: user.id,
          responseText,
          intermediateSteps,
        })
        sendTerminal({
          type: 'done',
          response: responseText,
          sessionId,
          messageId,
        })

        if (isFirstMessage && !bootstrap && message.length > 0) {
          const title = message.length > 80 ? message.slice(0, 77) + '...' : message
          await scopedDb.update(chatSession).set({ title }).where(eq(chatSession.id, sessionId))
        }
      } catch (err) {
        const details = collectErrorMessages(err)
        const msg = details[0] ?? 'An unexpected error occurred.'
        console.error(`[${options.logTag ?? 'api/chat'}] agentChat threw`, { error: msg, details })
        sendTerminal(chatErrorTerminalPayload(err, details))
      } finally {
        if (reserved) {
          await deactivateTenantDbSession(reserved).catch(() => {})
          await reserved.release()
        }
        if (!terminalSent) {
          sendTerminal({
            type: 'error',
            error: 'Chat ended before a response was received.',
            details: ['stream closed without terminal event'],
          })
        }
        await closeStream()
      }
    })()

    chatWork.catch((err) => {
      console.error(`[${options.logTag ?? 'api/chat'}] chatWork rejected`, err)
      if (!terminalSent) {
        sendTerminal({
          type: 'error',
          error: 'Chat ended before a response was received.',
          details: [err instanceof Error ? err.message : String(err)],
        })
      }
      void closeStream()
    })

    return new Response(readable, {
      headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
    })
  }

  try {
    const result = await runWithTrace(crypto.randomUUID(), () =>
      agentChat({
        userId: user.id,
        messages: [...history, { role: 'user', content: agentUserMessage }],
        mode: sessionMode,
      }),
    )

    const responseText = sanitizeFinalAnswerText(result.response)
    const messageId = await persistAssistantMessage(db, sessionId, user.id, responseText)

    if (isFirstMessage && !bootstrap && message.length > 0) {
      const title = message.length > 80 ? message.slice(0, 77) + '...' : message
      await db.update(chatSession).set({ title }).where(eq(chatSession.id, sessionId))
    }

    return json({
      response: responseText,
      history: result.messages.filter((m) => m.role !== 'system'),
      sessionId,
      messageId,
    })
  } catch (err) {
    console.error(`[${options.logTag ?? 'api/chat'}] agentChat threw`, {
      error: err instanceof Error ? err.message : String(err),
    })
    if (isInsufficientCreditsError(err)) {
      return json(insufficientCreditsPayload(err), { status: 402 })
    }
    return json(
      { response: 'An unexpected error occurred.', history: [], sessionId },
      { status: 500 },
    )
  }
}
