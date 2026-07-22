import type { ChatStreamEvent } from './chat-stream-types'
import {
  INSUFFICIENT_CREDITS_CODE,
  isInsufficientCreditsChatError,
} from '$lib/billing/insufficient-credits'
import { trackInsufficientCredits } from '$lib/analytics/billing-events'

export type ChatNdjsonDone = Extract<ChatStreamEvent, { type: 'done' }>

export type ChatProgressEvent = Exclude<ChatStreamEvent, { type: 'done' } | { type: 'error' }>

export class ChatStreamError extends Error {
  readonly details?: string[]
  readonly code?: string
  readonly availableCredits?: number
  readonly requiredCredits?: number

  constructor(event: Extract<ChatStreamEvent, { type: 'error' }>) {
    super(event.error || 'Chat failed')
    this.name = 'ChatStreamError'
    this.details = event.details
    if (event.code === INSUFFICIENT_CREDITS_CODE) {
      this.code = event.code
      this.availableCredits = event.availableCredits
      this.requiredCredits = event.requiredCredits
    }
  }
}

export { isInsufficientCreditsChatError }

function parseNdjsonLine(line: string): ChatStreamEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as ChatStreamEvent
  } catch {
    throw new Error(`Chat stream contained invalid data (${trimmed.slice(0, 80)}).`)
  }
}

export async function consumeChatNdjsonStream(
  res: Response,
  onEvent: (event: ChatProgressEvent) => void,
  signal?: AbortSignal,
): Promise<ChatNdjsonDone> {
  const reader = res.body?.getReader()
  if (!reader) {
    throw new Error('Chat response had no body to read.')
  }

  signal?.addEventListener('abort', () => {
    void reader.cancel()
  })

  const decoder = new TextDecoder()
  let buffer = ''

  const dispatchLine = (rawLine: string): ChatNdjsonDone | 'continue' => {
    const event = parseNdjsonLine(rawLine)
    if (!event) return 'continue'

    if (event.type === 'error') {
      if (event.code === INSUFFICIENT_CREDITS_CODE) {
        trackInsufficientCredits({
          surface: 'chat',
          phase: event.phase ?? 'precheck',
          required_credits: event.requiredCredits,
          available_credits: event.availableCredits,
        })
      }
      throw new ChatStreamError(event)
    }
    if (event.type === 'done') {
      return event
    }

    onEvent(event)
    return 'continue'
  }

  const flushBuffer = (): ChatNdjsonDone | 'continue' => {
    const remaining = buffer.trim()
    buffer = ''
    if (!remaining) return 'continue'
    return dispatchLine(remaining)
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const rawLine = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        const result = dispatchLine(rawLine)
        if (result !== 'continue') return result
      }
      if (done) break
    }

    const trailing = flushBuffer()
    if (trailing !== 'continue') return trailing
  } catch (e) {
    if (e instanceof Error && (e.name === 'AbortError' || signal?.aborted)) {
      throw new DOMException('Chat cancelled', 'AbortError')
    }
    throw e
  }

  if (signal?.aborted) {
    throw new DOMException('Chat cancelled', 'AbortError')
  }
  throw new Error('Chat stream ended before completion.')
}
