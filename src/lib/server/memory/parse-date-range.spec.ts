import { beforeEach, describe, expect, it, vi } from 'vitest'

const { llmChatCompletionMock } = vi.hoisted(() => ({
  llmChatCompletionMock: vi.fn(),
}))

vi.mock('$lib/server/llm/llm-client', () => ({
  llmChatCompletion: llmChatCompletionMock,
}))

import {
  isParseDateRangeGatewayFailure,
  parseDateRangePhrase,
  parseDateRangePayload,
  type ParsedDateRange,
} from './parse-date-range'

function makeResponse(content: string) {
  return {
    choices: [{ message: { content } }],
  }
}

describe('parseDateRangePayload', () => {
  it('accepts a valid absolute range payload', () => {
    const parsed = parseDateRangePayload({
      from: '2026-07-14T00:00:00.000Z',
      to: '2026-07-20T23:59:59.999Z',
      includeUndated: false,
      label: 'Last week',
    })
    expect(parsed).toEqual({
      from: '2026-07-14T00:00:00.000Z',
      to: '2026-07-20T23:59:59.999Z',
      includeUndated: false,
      label: 'Last week',
    } satisfies ParsedDateRange)
  })

  it('accepts unbounded all-time (null from/to)', () => {
    expect(
      parseDateRangePayload({
        from: null,
        to: null,
        includeUndated: true,
        label: 'All time',
      }),
    ).toEqual({
      from: null,
      to: null,
      includeUndated: true,
      label: 'All time',
    })
  })

  it('rejects invalid shapes', () => {
    expect(() => parseDateRangePayload(null)).toThrow(/date range/i)
    expect(() =>
      parseDateRangePayload({ from: 'x', to: null, includeUndated: true, label: 'x' }),
    ).toThrow()
    expect(() =>
      parseDateRangePayload({ from: null, to: null, includeUndated: 'yes', label: 'x' }),
    ).toThrow()
  })
})

describe('parseDateRangePhrase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls the LLM with now ISO, timezone, and the phrase; returns validated JSON', async () => {
    llmChatCompletionMock.mockResolvedValueOnce(
      makeResponse(
        JSON.stringify({
          from: '2026-07-14T00:00:00.000Z',
          to: '2026-07-20T23:59:59.999Z',
          includeUndated: false,
          label: 'Last week',
        }),
      ),
    )

    const result = await parseDateRangePhrase({
      userId: 'u1',
      phrase: 'last week',
      nowIso: '2026-07-21T12:00:00.000Z',
      timeZone: 'Europe/Berlin',
    })

    expect(result.label).toBe('Last week')
    expect(result.from).toBe('2026-07-14T00:00:00.000Z')
    expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
    const call = llmChatCompletionMock.mock.calls[0]?.[0]
    expect(call?.responseFormat).toBe('json_object')
    expect(call?.userId).toBe('u1')
    expect(call?.logContext).toBe('timeline_parse_date_range')
    expect(call?.maxTokens).toBe(256)
    // Same shared client as every other tool — no provider/model override.
    expect(call?.routingRuleId).toBeUndefined()
    const userContent = call?.messages?.find((m: { role: string }) => m.role === 'user')
      ?.content as string
    expect(userContent).toContain('last week')
    expect(userContent).toContain('2026-07-21T12:00:00.000Z')
    expect(userContent).toContain('Europe/Berlin')
  })

  it('fails when the LLM returns invalid JSON shape', async () => {
    llmChatCompletionMock.mockResolvedValueOnce(makeResponse('{"oops":true}'))
    await expect(
      parseDateRangePhrase({
        userId: 'u1',
        phrase: 'yesterday',
        nowIso: '2026-07-21T12:00:00.000Z',
        timeZone: 'UTC',
      }),
    ).rejects.toThrow(/date range/i)
  })
})

describe('isParseDateRangeGatewayFailure', () => {
  it('detects shared-client gateway/timeout failures', () => {
    expect(isParseDateRangeGatewayFailure('LLM HTTP 502: bad gateway')).toBe(true)
    expect(isParseDateRangeGatewayFailure('LLM HTTP 503: unavailable')).toBe(true)
    expect(isParseDateRangeGatewayFailure('LLM request timed out after 60000ms')).toBe(true)
    expect(isParseDateRangeGatewayFailure('Invalid date range LLM response: x')).toBe(false)
  })
})
