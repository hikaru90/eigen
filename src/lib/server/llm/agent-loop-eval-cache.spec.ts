import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExtendedPrivateEnv } from '$lib/server/env/private-env'
import { createEvalLlmCache, withEvalLlmCache } from '$lib/server/llm/eval-llm-cache'

// Real agentChat + real llmChatCompletion + real eval cache; only the gateway (fetch), the
// database, the wallet and the tool registry are faked. The shape under test is the PersonaMem
// p555 failure: the model answers with valid JSON of the wrong shape, the loop rejects it, and
// the response cache used to replay that reply (and every re-ask built on it) forever.

const { mockEnv, chargeMock, answerQuestionMock, mcpToolMap } = vi.hoisted(() => {
  const answerQuestionMock = vi.fn()
  return {
    mockEnv: {
      LLM_MIN_REQUEST_INTERVAL_MS: '0',
      LLM_REQUEST_TIMEOUT_MS: '',
      LLM_SERIAL_REQUESTS: '',
      OPENROUTER_BASE_URL: 'https://openrouter.example/api/v1',
      SERVICE_API_KEY_OPENROUTER: 'service-openrouter-key',
    } as ExtendedPrivateEnv,
    chargeMock: vi.fn(),
    answerQuestionMock,
    mcpToolMap: new Map<string, typeof answerQuestionMock>([
      ['answer_question', answerQuestionMock],
    ]),
  }
})

vi.mock('$lib/server/env/private-env', () => ({ env: mockEnv }))
vi.mock('$lib/server/db', () => ({ getDb: () => ({}) }))
vi.mock('$lib/server/activity/log-call', () => ({ logActivityCall: vi.fn() }))
vi.mock('$lib/server/analytics/posthog-server', () => ({ captureServerEvent: vi.fn() }))
vi.mock('$lib/server/billing/usage-gate', () => ({
  withPlatformBilling: vi.fn(
    async (_userId: string, settle: (result: unknown) => number, fn: () => Promise<unknown>) => {
      const result = await fn()
      chargeMock(settle(result))
      return result
    },
  ),
}))
vi.mock('$lib/server/mcp/registry', () => ({
  MCP_TOOL_MAP: mcpToolMap,
  CHAT_AGENT_TOOL_NAMES: ['answer_question'],
  buildChatAgentToolDescriptionBlock: () => '',
  isChatAgentTool: (name: string) => name === 'answer_question',
}))

import { agentChat, AgentParseError } from './agent-loop'

const MODEL_DIR = 'deepseek-deepseek-v4.1-flash-1017'
const TENANT = 'public-bench-personamem-v2-capture-test-p555'

function gatewayReply(payload: unknown): Response {
  const body = {
    choices: [{ message: { content: JSON.stringify(payload) } }],
    usage: { cost: 0.001 },
  }
  return { ok: true, status: 200, text: async () => JSON.stringify(body) } as unknown as Response
}

const WRONG_SHAPE = { thought: 'I should look this up' }
const TOOL_CALL = { tool: 'answer_question', arguments: { question: 'What bread do I like?' } }

const ask = () =>
  agentChat({ userId: TENANT, messages: [{ role: 'user', content: 'What bread do I like?' }] })

const requestBody = (fetchMock: ReturnType<typeof vi.fn>, call: number) => {
  const [, init] = fetchMock.mock.calls[call] as unknown as [string, { body: string }]
  return JSON.parse(init.body) as { messages: Array<{ role: string; content: string }> }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-loop-eval-cache-'))
  vi.clearAllMocks()
  answerQuestionMock.mockResolvedValue({
    answer: 'Answer: Sourdough.\nEvidence:\n- likes sourdough [id=t1]\nUnknown:\n- none',
    citations: ['t1'],
    retrieved: [],
    conflicts: [],
  })
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

describe('agent loop under the eval response cache (p555)', () => {
  it('wrong-shape JSON is evicted and re-asked with the required shape, then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(gatewayReply(WRONG_SHAPE))
      .mockResolvedValueOnce(gatewayReply(TOOL_CALL))
    vi.stubGlobal('fetch', fetchMock)
    const cache = createEvalLlmCache(dir)

    const result = await withEvalLlmCache(cache, ask)

    expect(result.response).toMatch(/Sourdough/)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const reAsk = requestBody(fetchMock, 1).messages.at(-1)
    expect(reAsk?.role).toBe('user')
    expect(reAsk?.content).toMatch(/"tool".*"answer"/)
    // the rejected reply is gone from the cache; only the accepted one remains
    expect(readdirSync(join(dir, MODEL_DIR))).toHaveLength(1)
  })

  it('a wrong-shape reply is not replayed on the next run: the first request reaches the gateway again', async () => {
    const failing = vi.fn(async () => gatewayReply(WRONG_SHAPE))
    vi.stubGlobal('fetch', failing)
    const cache = createEvalLlmCache(dir)

    await withEvalLlmCache(cache, async () => {
      await expect(ask()).rejects.toThrow(AgentParseError)
    })

    const recovering = vi.fn(async () => gatewayReply(TOOL_CALL))
    vi.stubGlobal('fetch', recovering)
    const result = await withEvalLlmCache(createEvalLlmCache(dir), ask)

    expect(result.response).toMatch(/Sourdough/)
    expect(recovering).toHaveBeenCalledTimes(1)
  })

  it('repeated wrong shape fails loud after the bound and leaves nothing cached', async () => {
    const fetchMock = vi.fn(async () => gatewayReply(WRONG_SHAPE))
    vi.stubGlobal('fetch', fetchMock)
    const cache = createEvalLlmCache(dir)

    await withEvalLlmCache(cache, async () => {
      await expect(ask()).rejects.toThrow(
        'The model JSON must include either a "tool" or an "answer" field.',
      )
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(readdirSync(join(dir, MODEL_DIR))).toHaveLength(0)
  })

  it('an unknown tool is evicted too and the re-ask can succeed', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(gatewayReply({ tool: 'no_such_tool', arguments: {} }))
      .mockResolvedValueOnce(gatewayReply(TOOL_CALL))
    vi.stubGlobal('fetch', fetchMock)

    const result = await withEvalLlmCache(createEvalLlmCache(dir), ask)

    expect(result.response).toMatch(/Sourdough/)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(readdirSync(join(dir, MODEL_DIR))).toHaveLength(1)
  })

  it('without an eval cache the same re-ask works and eviction is a no-op', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(gatewayReply(WRONG_SHAPE))
      .mockResolvedValueOnce(gatewayReply(TOOL_CALL))
    vi.stubGlobal('fetch', fetchMock)

    const result = await ask()

    expect(result.response).toMatch(/Sourdough/)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
