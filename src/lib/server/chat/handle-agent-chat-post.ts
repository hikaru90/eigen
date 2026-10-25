import type { RequestEvent } from '@sveltejs/kit'
import { error, json } from '@sveltejs/kit'
import { runWithTrace } from '$lib/server/activity/trace-context'
import { tenantUserAsyncLocal } from '$lib/server/billing/context'
import {
  insufficientCreditsPayload,
  isInsufficientCreditsError,
} from '$lib/server/billing/insufficient-credits'
import {
  beginAskTurn,
  finalAnswerText,
  getOrCreateSession,
  intermediateStepFromEvent,
  persistAssistantMessage,
  persistStreamedAssistantTurn,
  runAskTurn,
  titleSessionFromMessage,
  type IntermediateStep,
} from '$lib/server/chat/run-ask-turn'
import {
  appDbAsyncLocal,
  appSql,
  createScopedDrizzle,
  getDb,
  activateTenantDbSession,
  deactivateTenantDbSession,
} from '$lib/server/db'
import type { ChatSessionMode } from '$lib/server/db/brain.schema'
import { agentChat } from '$lib/server/llm/agent-loop'

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

/**
 * A failed run, as the assistant turn history keeps: the question was already stored,
 * so without this the session shows it with no answer. The UI renders `variant: error`
 * as an error note; the agent history skips it.
 */
export function failedAssistantTurn(payload: { error: string; code?: unknown }): {
  content: string
  metadata: Record<string, unknown>
} {
  return {
    content: payload.error,
    metadata: { variant: 'error', ...(typeof payload.code === 'string' ? { code: payload.code } : {}) },
  }
}

export const BRIEFING_BOOTSTRAP_MESSAGES: Record<string, string> = {
  morning:
    "Give my morning briefing: today's agenda, top 3 priorities, and open loops. Use list_projects and get_project_timeline for project agendas, answer_question for priorities/open loops, and retrieve_thoughts only to browse recent thoughts. Be calm and concise.",
  evening:
    'Give my evening review: what was completed today, what rolls over, and gentle suggestions for tomorrow. Use list_projects and get_project_timeline for project status, and answer_question for what completed or rolls over.',
  weekly:
    'Give my weekly review: completions this week, overdue debt, patterns, and 2–3 focus suggestions for next week. Use list_projects, get_project_timeline, answer_question, and retrieve_thoughts only to browse recent thoughts.',
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

  const accept = event.request.headers?.get('accept') ?? ''
  const streamNdjson = accept.includes('application/x-ndjson')

  if (streamNdjson) {
    // The streaming shell keeps its own agent run (reserved connection, ndjson events);
    // it shares the turn's begin/persist helpers with runAskTurn.
    const { history, isFirstMessage } = await beginAskTurn(db, {
      userId: user.id,
      sessionId,
      message,
      bootstrap,
    })
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

    const intermediateSteps: IntermediateStep[] = []

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
                aiSessionId: sessionId,
                onEvent: (evt) => {
                  if (!streamClosed) {
                    writeLine(evt)
                  }
                  const step = intermediateStepFromEvent(evt)
                  if (step) intermediateSteps.push(step)
                },
                db: scopedDb,
              }),
            ),
          ),
        )

        const responseText = finalAnswerText(result.response, intermediateSteps)
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
          await titleSessionFromMessage(scopedDb, sessionId, message)
        }
      } catch (err) {
        const details = collectErrorMessages(err)
        const msg = details[0] ?? 'An unexpected error occurred.'
        console.error(`[${options.logTag ?? 'api/chat'}] agentChat threw`, { error: msg, details })
        const payload = chatErrorTerminalPayload(err, details)
        if (reserved && !bootstrap) {
          const turn = failedAssistantTurn(payload)
          await persistAssistantMessage(
            createScopedDrizzle(reserved),
            sessionId,
            user.id,
            turn.content,
            turn.metadata,
          ).catch((persistErr) =>
            console.error(`[${options.logTag ?? 'api/chat'}] failed turn not stored`, persistErr),
          )
        }
        sendTerminal(payload)
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
    const result = await runAskTurn({
      db,
      userId: user.id,
      sessionId,
      message: agentUserMessage,
      mode: sessionMode,
      bootstrap,
    })

    return json({
      response: result.answer,
      history: result.messages.filter((m) => m.role !== 'system'),
      sessionId,
      messageId: result.messageId,
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
