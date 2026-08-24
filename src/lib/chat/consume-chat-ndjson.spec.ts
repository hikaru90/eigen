import type { ChatProgressEvent } from './consume-chat-ndjson'
import { describe, expect, it } from 'vitest'
import { consumeChatNdjsonStream } from './consume-chat-ndjson'

function ndjsonResponse(lines: string[]) {
  const encoder = new TextEncoder()
  const body = new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line))
      }
      controller.close()
    },
  })
  return new Response(body, { headers: { 'content-type': 'application/x-ndjson' } })
}

describe('consumeChatNdjsonStream', () => {
  it('parses progress events then returns done', async () => {
    const res = ndjsonResponse([
      '{"type":"thinking","content":"planning"}\n',
      '{"type":"tool_call","tool":"retrieve_thoughts","arguments":{"query":"coffee"}}\n',
      '{"type":"tool_result","tool":"retrieve_thoughts","preview":"{\\"results\\":[]}"}\n',
      '{"type":"done","response":"You like sweet coffee.","sessionId":"s1","messageId":"m1"}\n',
    ])
    const events: ChatProgressEvent[] = []
    const done = await consumeChatNdjsonStream(res, (e) => events.push(e))
    expect(events.map((e) => e.type)).toEqual(['thinking', 'tool_call', 'tool_result'])
    expect(done).toEqual({
      type: 'done',
      response: 'You like sweet coffee.',
      sessionId: 's1',
      messageId: 'm1',
    })
  })

  it('parses final line without trailing newline', async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode('{"type":"done","response":"ok","sessionId":"s1","messageId":"m1"}'),
        )
        controller.close()
      },
    })
    const res = new Response(body)
    const done = await consumeChatNdjsonStream(res, () => undefined)
    expect(done.response).toBe('ok')
  })

  it('throws ChatStreamError on generic error line', async () => {
    const res = ndjsonResponse(['{"type":"error","error":"LLM unavailable"}\n'])
    await expect(consumeChatNdjsonStream(res, () => undefined)).rejects.toThrow('LLM unavailable')
  })

  it('throws ChatStreamError with insufficient_credits code', async () => {
    const res = ndjsonResponse([
      '{"type":"error","error":"Insufficient Eigen platform credits","code":"insufficient_credits","availableCredits":0,"requiredCredits":50,"phase":"precheck","creditsPerUsd":1000}\n',
    ])
    await expect(consumeChatNdjsonStream(res, () => undefined)).rejects.toMatchObject({
      name: 'ChatStreamError',
      code: 'insufficient_credits',
      availableCredits: 0,
      requiredCredits: 50,
    })
  })

  it('throws when stream ends without terminal event', async () => {
    const res = ndjsonResponse(['{"type":"thinking","content":"still working"}\n'])
    await expect(consumeChatNdjsonStream(res, () => undefined)).rejects.toThrow(
      'Chat stream ended before completion.',
    )
  })

  it('throws deterministically on corrupt NDJSON line', async () => {
    const res = ndjsonResponse(['not-json\n'])
    await expect(consumeChatNdjsonStream(res, () => undefined)).rejects.toThrow(/invalid data/i)
  })

  it('throws when response body is missing', async () => {
    const res = new Response(null)
    await expect(consumeChatNdjsonStream(res, () => undefined)).rejects.toThrow(
      'Chat response had no body to read.',
    )
  })

  it('rethrows AbortError when signal is aborted', async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('{"type":"thinking","content":"…"}\n'))
      },
    })
    const res = new Response(body)
    const ac = new AbortController()
    const pending = consumeChatNdjsonStream(res, () => undefined, ac.signal)
    ac.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
