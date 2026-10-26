import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { activityProviderForLlmConfig } from '$lib/server/activity/gateway-providers'
import { logActivityCall } from '$lib/server/activity/log-call'
import { captureServerEvent } from '$lib/server/analytics/posthog-server'
import { resolveBillingUserId } from '$lib/server/billing/context'
import {
  loadPlatformLlmConfig,
  loadPlatformOpenRouterSttConfig,
} from '$lib/server/billing/platform-llm'
import { withPlatformBilling } from '$lib/server/billing/usage-gate'
import { getDb } from '$lib/server/db'
import { env } from '$lib/server/env/private-env'
import { LlmHttpError } from '$lib/server/llm/errors'
import {
  evalLlmCacheFor,
  isUsableJsonModeResponse,
  rememberEvalLlmCacheOrigin,
  type EvalLlmCache,
} from '$lib/server/llm/eval-llm-cache'
import {
  gatewayReportedCostUsdForLog,
  requireGatewayReportedCostUsd,
  type TokenUsage,
} from '$lib/server/llm/gateway-cost'
import { isGraphScaleQuiet } from '$lib/server/observability/graph-scale-quiet'
import { sanitizeChatMessages } from '$lib/server/observability/strip-embeddings'
import {
  guardOutgoingEmbeddingInput,
  guardOutgoingMessages,
} from '$lib/server/security/gateway-guard'

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }
export {
  extractGatewayReportedCostUsd,
  gatewayReportedCostUsdForLog,
  requireGatewayReportedCostUsd,
} from '$lib/server/llm/gateway-cost'

type RoutingConfig = { model: string }
type AiMessageRole = 'system' | 'user' | 'assistant'
type AiOutputChoice = { role: AiMessageRole; content: string }

export type { LlmProviderKind, ResolvedLlmConfig } from '$lib/server/llm/types'
import type { ResolvedLlmConfig } from '$lib/server/llm/types'

const EMBEDDING_DIMENSIONS = 1536
const AI_ID_ALLOWED = /^[A-Za-z0-9\-_.~@()!':|]+$/

function normalizeAiIdentifier(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim()
  if (!trimmed) return fallback
  if (AI_ID_ALLOWED.test(trimmed)) return trimmed
  const normalized = trimmed.replace(/[^A-Za-z0-9\-_.~@()!':|]/g, '-').replace(/-+/g, '-')
  return normalized || fallback
}

function messageContentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && 'text' in part) {
        const text = (part as { text?: unknown }).text
        return typeof text === 'string' ? text : ''
      }
      return ''
    })
    .filter(Boolean)
    .join('')
}

function extractAiOutputChoices(body: unknown): AiOutputChoice[] {
  if (!body || typeof body !== 'object') return []
  const choices = (body as { choices?: unknown }).choices
  if (!Array.isArray(choices)) return []
  return choices
    .map((choice): AiOutputChoice | null => {
      if (!choice || typeof choice !== 'object') return null
      const message = (choice as { message?: { role?: unknown; content?: unknown } }).message
      if (!message || typeof message !== 'object') return null
      const role = message.role === 'system' || message.role === 'user' ? message.role : 'assistant'
      return {
        role,
        content: messageContentText(message.content),
      }
    })
    .filter((choice): choice is AiOutputChoice => choice !== null)
}

/** Hostname from gateway base URL for activity logs (handles missing `https://`). */
function gatewayHostFromBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/$/, '')
  try {
    return new URL(trimmed).hostname.toLowerCase()
  } catch {
    try {
      return new URL(`https://${trimmed}`).hostname.toLowerCase()
    } catch {
      return trimmed.slice(0, 120)
    }
  }
}

/**
 * Per-user rate-limit state. Keyed by userId so that concurrent captures from different users
 * do not queue behind each other — only a single user's own successive LLM calls are spaced out.
 * Using a shared global queue previously caused one user's capture to block every other user's
 * LLM access for the duration of their pipeline.
 */
type UserLlmState = {
  lastRequestAt: number
  lastEndedAt: number
  queue: Promise<void>
  /** Separate queue for STT requests — avoids contention with ingest/enrichment. */
  sttQueue: Promise<void>
  lastSttRequestAt: number
  serialQueue: Promise<void>
}
const userLlmState = new Map<string, UserLlmState>()

/** Nested LLM calls (e.g. agent tool follow-ups) must not re-enter the user gate. */
const llmNestDepth = new AsyncLocalStorage<number>()

function getUserLlmState(userId: string): UserLlmState {
  let state = userLlmState.get(userId)
  if (!state) {
    state = {
      lastRequestAt: 0,
      lastEndedAt: 0,
      queue: Promise.resolve(),
      sttQueue: Promise.resolve(),
      lastSttRequestAt: 0,
      serialQueue: Promise.resolve(),
    }
    userLlmState.set(userId, state)
  }
  return state
}

function serialLlmRequestsEnabled(): boolean {
  const raw = env.LLM_SERIAL_REQUESTS?.trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

/**
 * Serial mode: one in-flight request per user; next starts only after the prior finishes
 * and `LLM_MIN_REQUEST_INTERVAL_MS` has elapsed since it ended.
 */
async function runLlmRequestGated<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const depth = llmNestDepth.getStore() ?? 0
  if (depth > 0) {
    return llmNestDepth.run(depth + 1, fn)
  }

  const intervalMs = minRequestIntervalMs()
  const state = getUserLlmState(userId)

  // Chain synchronously (assign before await) so concurrent callers cannot pass the gate together.
  const slot = state.serialQueue.then(async () => {
    const elapsed = Date.now() - state.lastEndedAt
    const waitMs = Math.max(0, intervalMs - elapsed)
    if (waitMs > 0) {
      await sleep(waitMs)
    }
    try {
      return await llmNestDepth.run(1, fn)
    } finally {
      state.lastEndedAt = Date.now()
    }
  })
  state.serialQueue = slot.then(
    () => undefined,
    () => undefined,
  )
  return slot
}

function extractUsage(body: unknown): TokenUsage | undefined {
  if (!body || typeof body !== 'object') return undefined
  return (body as { usage?: TokenUsage }).usage
}

function minRequestIntervalMs(): number {
  const raw = env.LLM_MIN_REQUEST_INTERVAL_MS?.trim()
  if (!raw) return 1000
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('LLM_MIN_REQUEST_INTERVAL_MS must be a non-negative number')
  }
  return parsed
}

function requestTimeoutMs(): number {
  const raw = env.LLM_REQUEST_TIMEOUT_MS?.trim()
  if (!raw) return 60_000 // 60 s default
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('LLM_REQUEST_TIMEOUT_MS must be a positive number')
  }
  return parsed
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function extractChatResponseText(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const choices = (body as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return ''
  const message = (choices[0] as { message?: { content?: unknown } }).message
  const content = message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part) {
          const text = (part as { text?: unknown }).text
          return typeof text === 'string' ? text : ''
        }
        return ''
      })
      .filter(Boolean)
      .join('')
  }
  return ''
}

function logLlmChatRequest(logCtx: string, attempt: number, messages: ChatMessage[]): void {
  if (isGraphScaleQuiet()) return
  console.log(`[llm.chat:${logCtx}] request attempt ${attempt}/${3}`)
  for (const message of messages) {
    console.log(`[llm.chat:${logCtx}] ${message.role}:\n${message.content}`)
  }
}

function logLlmChatResponse(logCtx: string, attempt: number, body: unknown): void {
  if (isGraphScaleQuiet()) return
  console.log(`[llm.chat:${logCtx}] response attempt ${attempt}:\n${extractChatResponseText(body)}`)
}

const EMBEDDING_LOG_INPUT_MAX = 100

function truncateForEmbeddingLog(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= EMBEDDING_LOG_INPUT_MAX) return trimmed
  return `${trimmed.slice(0, EMBEDDING_LOG_INPUT_MAX - 3)}...`
}

function logLlmEmbeddingRequest(
  attempt: number,
  input: string | string[],
  logCtx = 'embedding',
): void {
  if (isGraphScaleQuiet()) {
    console.info(`[graph-scale] llm ${logCtx} attempt ${attempt}/${3}`)
    return
  }
  console.log(`[llm.embedding] request attempt ${attempt}/${3}`)
  if (Array.isArray(input)) {
    for (const [index, text] of input.entries()) {
      console.log(`[llm.embedding] input[${index}]: ${truncateForEmbeddingLog(text)}`)
    }
  } else {
    console.log(`[llm.embedding] input: ${truncateForEmbeddingLog(input)}`)
  }
}

function logLlmSttRequest(
  attempt: number,
  model: string,
  audio: { bytes: Uint8Array; format: string },
): void {
  if (isGraphScaleQuiet()) return
  console.log(
    `[llm.stt] request attempt ${attempt}/${3} model=${model} format=${audio.format} bytes=${audio.bytes.byteLength}`,
  )
}

function logLlmSttResponse(attempt: number, body: unknown): void {
  if (isGraphScaleQuiet()) return
  if (!body || typeof body !== 'object') {
    console.log(`[llm.stt] response attempt ${attempt}: (empty response)`)
    return
  }
  if ('text' in body && typeof (body as { text?: unknown }).text === 'string') {
    console.log(`[llm.stt] response attempt ${attempt}:\n${(body as { text: string }).text}`)
    return
  }
  const choices = (body as { choices?: unknown }).choices
  if (Array.isArray(choices) && choices[0] && typeof choices[0] === 'object') {
    const content = (choices[0] as { message?: { content?: unknown } }).message?.content
    if (typeof content === 'string') {
      console.log(`[llm.stt] response attempt ${attempt}:\n${content}`)
      return
    }
  }
  console.log(`[llm.stt] response attempt ${attempt}: (no transcript text in response)`)
}

async function waitForLlmRateLimit(userId: string): Promise<void> {
  if (serialLlmRequestsEnabled()) return

  const intervalMs = minRequestIntervalMs()
  if (intervalMs === 0) return

  const state = getUserLlmState(userId)

  // Each call appends a slot to this user's queue. The slot:
  //   1. Waits for the previous slot to finish (i.e. previous request started).
  //   2. Computes how long to wait based on when the last request started.
  //   3. Sleeps only for that gap.
  //   4. Records the new start time and resolves — releasing the queue for the next caller.
  //
  // Crucially the slot resolves *before* the HTTP request completes, so a nested
  // llmChatCompletion call (e.g. from answer_question inside the agent loop) never
  // deadlocks waiting on the outer call's in-flight HTTP request.
  const slot = state.queue.then(async () => {
    const now = Date.now()
    const elapsed = now - state.lastRequestAt
    const waitMs = Math.max(0, intervalMs - elapsed)
    if (waitMs > 0) {
      await sleep(waitMs)
    }
    state.lastRequestAt = Date.now()
    // Slot resolves here — next queued call for this user can now run its spacing check.
  })
  state.queue = slot
  await slot
}

/**
 * Rate limiter for STT requests — separate queue so speech-to-text does not contend
 * with ingest/enrichment LLM calls. Uses the same per-user interval but independent
 * queue chain.
 */
async function waitForSttRateLimit(userId: string): Promise<void> {
  if (serialLlmRequestsEnabled()) return

  const intervalMs = minRequestIntervalMs()
  if (intervalMs === 0) return

  const state = getUserLlmState(userId)

  const slot = state.sttQueue.then(async () => {
    const now = Date.now()
    const elapsed = now - state.lastSttRequestAt
    const waitMs = Math.max(0, intervalMs - elapsed)
    if (waitMs > 0) {
      await sleep(waitMs)
    }
    state.lastSttRequestAt = Date.now()
  })
  state.sttQueue = slot
  await slot
}

/**
 * Loads LLM config for billing (gateway keys + active provider preference).
 * Uses resolveBillingUserId so eval tenants bill/configure via the operator, not the
 * ephemeral eval user. Unrelated to tenant envelope encryption (thought/BYOK-at-rest DEK).
 */
async function loadLlmConfig(userId: string): Promise<ResolvedLlmConfig> {
  return loadPlatformLlmConfig(resolveBillingUserId(userId))
}

async function chatRoutingConfig(config: ResolvedLlmConfig): Promise<RoutingConfig> {
  const model = config.modelChat?.trim()
  if (!model) throw new Error('Platform chat model missing from the LLM config')
  return { model }
}

async function embeddingRoutingConfig(config: ResolvedLlmConfig): Promise<RoutingConfig> {
  const model = config.modelEmbedding?.trim()
  if (!model) throw new Error('Platform embedding model missing from the LLM config')
  return { model }
}

/**
 * Default completion budget when callers omit maxTokens.
 * Gateways that treat missing max_tokens as the full model context window
 * (e.g. 262144) reject small prompts: prompt + context > context.
 * Keep this well below typical context windows and large enough for JSON judges.
 */
export const DEFAULT_CHAT_MAX_TOKENS = 8192

/**
 * Chat completions: `POST ${baseUrl}/chat/completions`.
 * Platform chat via OpenRouter on the service key, with the pinned platform chat model.
 */
export async function llmChatCompletion(input: {
  userId: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  /** Dev/server observability only; appears in logs to disambiguate parallel chat uses. */
  logContext?: string
  /** OpenAI-compatible JSON object mode — gateway must support response_format. */
  responseFormat?: 'json_object'
  /** Optional conversation-level identifier for PostHog AI observability session grouping. */
  aiSessionId?: string
  /** Optional turn-level identifier for PostHog AI observability trace grouping. */
  aiTraceId?: string
}): Promise<unknown> {
  const cache = evalLlmCacheFor(input.userId)
  if (cache !== undefined) return llmChatCompletionCached(cache, input)
  return llmChatCompletionBilled(input)
}

type ChatCompletionInput = Parameters<typeof llmChatCompletionInner>[0]

function llmChatCompletionBilled(input: ChatCompletionInput): Promise<unknown> {
  return withPlatformBilling(
    input.userId,
    (body) => requireGatewayReportedCostUsd(body),
    () =>
      serialLlmRequestsEnabled()
        ? runLlmRequestGated(input.userId, () => llmChatCompletionInner(input))
        : llmChatCompletionInner(input),
  )
}

/** The exact JSON body of a chat completion request (also what the eval cache keys on). */
function chatRequestBody(
  input: { temperature?: number; maxTokens?: number; responseFormat?: 'json_object' },
  model: string,
  messages: ChatMessage[],
) {
  return {
    model,
    messages,
    ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    max_tokens: input.maxTokens ?? DEFAULT_CHAT_MAX_TOKENS,
    ...(input.responseFormat === 'json_object' ? { response_format: { type: 'json_object' } } : {}),
  }
}

function chatLogContext(input: { logContext?: string }): string {
  return (input.logContext?.trim() || 'chat').replace(/\s+/g, '_')
}

/**
 * Eval response cache (harness users only): a hit returns the stored response without touching
 * the wallet or the gateway; a miss pays as usual and persists the response before the wallet
 * is debited and before the caller sees it.
 */
async function llmChatCompletionCached(
  cache: EvalLlmCache,
  input: ChatCompletionInput,
): Promise<unknown> {
  const config = await loadLlmConfig(input.userId)
  const routing = await chatRoutingConfig(config)
  const logCtx = chatLogContext(input)
  const messages = guardOutgoingMessages(sanitizeChatMessages(input.messages), logCtx)
  const request = {
    endpoint: 'chat' as const,
    provider: config.provider,
    model: routing.model,
    body: chatRequestBody(input, routing.model, messages),
  }

  const hit = cache.lookup(request)
  if (hit !== undefined) {
    await logActivityCall(getDb(), input.userId, {
      provider: activityProviderForLlmConfig(config.provider),
      gatewayHost: gatewayHostFromBaseUrl(config.baseUrl),
      operation: `llm.chat.${logCtx}.cache_hit`,
      baseCostUsd: 0,
      context: messages.find((m) => m.role === 'user')?.content || '',
      durationMs: 0,
      cached: true,
    })
    cache.noteHit('chat', hit.costUsd)
    rememberEvalLlmCacheOrigin(hit.response, cache, request)
    return hit.response
  }

  let costUsd = 0
  const response = await withPlatformBilling(
    input.userId,
    (body) => requireGatewayReportedCostUsd(body),
    async () => {
      const body = await (serialLlmRequestsEnabled()
        ? runLlmRequestGated(input.userId, () => llmChatCompletionInner(input))
        : llmChatCompletionInner(input))
      costUsd = requireGatewayReportedCostUsd(body)
      // JSON mode: prose / empty content is returned (and billed) but never stored, so the
      // caller's failure + retry really asks the model again instead of replaying it.
      if (input.responseFormat !== 'json_object' || isUsableJsonModeResponse(body)) {
        cache.store(request, { response: body, costUsd })
        rememberEvalLlmCacheOrigin(body, cache, request)
      }
      return body
    },
  )
  cache.notePaid('chat', costUsd)
  return response
}

async function llmChatCompletionInner(input: {
  userId: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  logContext?: string
  responseFormat?: 'json_object'
  aiSessionId?: string
  aiTraceId?: string
}): Promise<unknown> {
  const config = await loadLlmConfig(input.userId)
  const activityProvider = activityProviderForLlmConfig(config.provider)
  const gatewayHost = gatewayHostFromBaseUrl(config.baseUrl)
  const url = `${config.baseUrl}/chat/completions`
  const routing = await chatRoutingConfig(config)
  const logCtx = chatLogContext(input)
  // gateway guard (secret-hygiene Design 3): nothing credential-shaped leaves, whoever the caller
  const messages = guardOutgoingMessages(sanitizeChatMessages(input.messages), logCtx)
  const aiSessionId = normalizeAiIdentifier(input.aiSessionId, `user-${input.userId}`)
  const aiTraceId = normalizeAiIdentifier(input.aiTraceId, randomUUID())

  const maxAttempts = 3
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attemptStart = Date.now()
    const db = getDb()
    try {
      if (!isGraphScaleQuiet()) {
        console.info(`[llm.chat:${logCtx}] attempt ${attempt}/${maxAttempts}`, {
          model: routing.model,
          messageCount: messages.length,
          totalChars: messages.reduce((n, m) => n + m.content.length, 0),
        })
      } else {
        console.info(`[graph-scale] llm ${logCtx} attempt ${attempt}/${maxAttempts}`)
      }
      logLlmChatRequest(logCtx, attempt, messages)
      await waitForLlmRateLimit(input.userId)
      const fetchStart = Date.now()
      const timeoutMs = requestTimeoutMs()
      const ac = new AbortController()
      const timeoutHandle = setTimeout(
        () => ac.abort(new Error(`LLM request timed out after ${timeoutMs}ms`)),
        timeoutMs,
      )
      let res: Response
      try {
        res = await fetch(url, {
          signal: ac.signal,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify(chatRequestBody(input, routing.model, messages)),
        })
      } finally {
        clearTimeout(timeoutHandle)
      }

      const text = await res.text()
      let json: unknown
      try {
        json = JSON.parse(text) as unknown
      } catch {
        json = { raw: text }
      }

      if (!res.ok) {
        console.error(`[llm.chat:${logCtx}] DIAG 4xx`, {
          status: res.status,
          model: routing.model,
          messageCount: messages.length,
          messageSizes: messages.map((m) => ({ role: m.role, len: m.content.length })),
          totalChars: messages.reduce((n, m) => n + m.content.length, 0),
          responseBody: text,
        })
        const message =
          typeof json === 'object' && json && 'error' in json
            ? JSON.stringify((json as { error?: unknown }).error)
            : text.slice(0, 500)
        throw new LlmHttpError(res.status, message)
      }

      const attemptMs = Date.now() - attemptStart
      const fetchMs = Date.now() - fetchStart
      const usage = extractUsage(json)
      const baseCost = gatewayReportedCostUsdForLog(json)
      if (!isGraphScaleQuiet()) {
        console.info(`[llm.chat:${logCtx}] gateway response ok`, {
          attempt,
          httpStatus: res.status,
          attemptMs,
          fetchMs,
          prompt_tokens: usage?.prompt_tokens,
          completion_tokens: usage?.completion_tokens,
          total_tokens: usage?.total_tokens,
        })
      }
      logLlmChatResponse(logCtx, attempt, json)
      // Extract first user message for context preview
      const firstUserMessage = messages.find((m) => m.role === 'user')?.content || ''
      await logActivityCall(db, input.userId, {
        provider: activityProvider,
        gatewayHost,
        operation: `llm.chat.${logCtx}.success(attempt=${attempt})`,
        baseCostUsd: baseCost,
        context: firstUserMessage,
        durationMs: attemptMs,
      })
      captureServerEvent({
        distinctId: input.userId,
        event: '$ai_generation',
        properties: {
          $ai_trace_id: aiTraceId,
          $ai_session_id: aiSessionId,
          $ai_model: routing.model,
          $ai_provider: config.provider,
          $ai_input: messages,
          $ai_input_tokens: usage?.prompt_tokens,
          $ai_output_choices: extractAiOutputChoices(json),
          $ai_output_tokens: usage?.completion_tokens,
          $ai_latency: attemptMs / 1000,
          $ai_http_status: res.status,
          $ai_base_url: config.baseUrl,
          $ai_request_url: url,
          $ai_stop_reason:
            typeof (json as { choices?: Array<{ finish_reason?: unknown }> })?.choices?.[0]
              ?.finish_reason === 'string'
              ? ((json as { choices: Array<{ finish_reason: string }> }).choices[0].finish_reason ??
                undefined)
              : undefined,
        },
      })

      return json
    } catch (err) {
      lastError = err
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[llm.chat:${logCtx}] attempt ${attempt} failed`, {
        afterMs: Date.now() - attemptStart,
        message: msg.slice(0, 500),
      })
      // Extract first user message for context preview
      const firstUserMessage = messages.find((m) => m.role === 'user')?.content || ''
      await logActivityCall(db, input.userId, {
        provider: activityProvider,
        gatewayHost,
        operation: `llm.chat.${logCtx}.error(attempt=${attempt})`,
        baseCostUsd: 0,
        context: firstUserMessage,
        errorMessage: msg,
        durationMs: Date.now() - attemptStart,
      })
      if (attempt === maxAttempts) {
        captureServerEvent({
          distinctId: input.userId,
          event: '$ai_generation',
          properties: {
            $ai_trace_id: aiTraceId,
            $ai_session_id: aiSessionId,
            $ai_model: routing.model,
            $ai_provider: config.provider,
            $ai_input: messages,
            $ai_is_error: true,
            $ai_error: msg,
            $ai_http_status: err instanceof LlmHttpError ? err.status : undefined,
            $ai_latency: (Date.now() - attemptStart) / 1000,
            $ai_base_url: config.baseUrl,
            $ai_request_url: url,
          },
        })
      }
      if (attempt === maxAttempts) break
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`LLM request failed after ${maxAttempts} attempts`)
}

/**
 * Embeddings: `POST ${baseUrl}/embeddings` with the pinned platform embedding model.
 */
export async function llmCreateEmbeddings(input: {
  userId: string
  input: string | string[]
}): Promise<unknown> {
  const cache = evalLlmCacheFor(input.userId)
  if (cache !== undefined) return llmCreateEmbeddingsCached(cache, input)
  return llmCreateEmbeddingsBilled(input)
}

type EmbeddingsInput = { userId: string; input: string | string[] }

function llmCreateEmbeddingsBilled(input: EmbeddingsInput): Promise<unknown> {
  return withPlatformBilling(
    input.userId,
    (body) => requireGatewayReportedCostUsd(body),
    () =>
      serialLlmRequestsEnabled()
        ? runLlmRequestGated(input.userId, () => llmCreateEmbeddingsInner(input))
        : llmCreateEmbeddingsInner(input),
  )
}

function embeddingRequestBody(model: string, input: string | string[]) {
  return { model, dimensions: EMBEDDING_DIMENSIONS, input }
}

/** Same contract as `llmChatCompletionCached`, for embeddings (the responses stay on disk only). */
async function llmCreateEmbeddingsCached(
  cache: EvalLlmCache,
  input: EmbeddingsInput,
): Promise<unknown> {
  const config = await loadLlmConfig(input.userId)
  const routing = await embeddingRoutingConfig(config)
  const embeddingInput = guardOutgoingEmbeddingInput(input.input, 'llm_embedding')
  const request = {
    endpoint: 'embeddings' as const,
    provider: config.provider,
    model: routing.model,
    body: embeddingRequestBody(routing.model, embeddingInput),
  }

  const hit = cache.lookup(request)
  if (hit !== undefined) {
    await logActivityCall(getDb(), input.userId, {
      provider: activityProviderForLlmConfig(config.provider),
      gatewayHost: gatewayHostFromBaseUrl(config.baseUrl),
      operation: 'llm.embedding.cache_hit',
      baseCostUsd: 0,
      context: Array.isArray(embeddingInput) ? embeddingInput[0] : embeddingInput,
      durationMs: 0,
      cached: true,
    })
    cache.noteHit('embeddings', hit.costUsd)
    return hit.response
  }

  let costUsd = 0
  const response = await withPlatformBilling(
    input.userId,
    (body) => requireGatewayReportedCostUsd(body),
    async () => {
      const body = await (serialLlmRequestsEnabled()
        ? runLlmRequestGated(input.userId, () => llmCreateEmbeddingsInner(input))
        : llmCreateEmbeddingsInner(input))
      costUsd = requireGatewayReportedCostUsd(body)
      cache.store(request, { response: body, costUsd })
      return body
    },
  )
  cache.notePaid('embeddings', costUsd)
  return response
}

async function llmCreateEmbeddingsInner(input: {
  userId: string
  input: string | string[]
}): Promise<unknown> {
  const config = await loadLlmConfig(input.userId)
  const activityProvider = activityProviderForLlmConfig(config.provider)
  const gatewayHost = gatewayHostFromBaseUrl(config.baseUrl)
  const url = `${config.baseUrl}/embeddings`
  const routing = await embeddingRoutingConfig(config)
  const embeddingInput = guardOutgoingEmbeddingInput(input.input, 'llm_embedding')

  const maxAttempts = 3
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attemptStart = Date.now()
    const db = getDb()
    try {
      logLlmEmbeddingRequest(attempt, embeddingInput)
      await waitForLlmRateLimit(input.userId)
      const embAc = new AbortController()
      const embTimeoutMs = requestTimeoutMs()
      const embTimeoutHandle = setTimeout(
        () => embAc.abort(new Error(`LLM embedding request timed out after ${embTimeoutMs}ms`)),
        embTimeoutMs,
      )
      let res: Response
      try {
        res = await fetch(url, {
          signal: embAc.signal,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify(embeddingRequestBody(routing.model, embeddingInput)),
        })
      } finally {
        clearTimeout(embTimeoutHandle)
      }

      const text = await res.text()
      let json: unknown
      try {
        json = JSON.parse(text) as unknown
      } catch {
        json = { raw: text }
      }

      if (!res.ok) {
        const message =
          typeof json === 'object' && json && 'error' in json
            ? JSON.stringify((json as { error?: unknown }).error)
            : text.slice(0, 500)
        throw new LlmHttpError(res.status, message)
      }

      const baseCost = gatewayReportedCostUsdForLog(json)
      // Extract preview from embedding input
      const embeddingPreview = Array.isArray(embeddingInput) ? embeddingInput[0] : embeddingInput
      await logActivityCall(db, input.userId, {
        provider: activityProvider,
        gatewayHost,
        operation: `llm.embedding.success(attempt=${attempt})`,
        baseCostUsd: baseCost,
        context: embeddingPreview,
        durationMs: Date.now() - attemptStart,
      })

      return json
    } catch (err) {
      lastError = err
      const message = err instanceof Error ? err.message : String(err)
      // Extract preview from embedding input
      const embeddingPreview = Array.isArray(embeddingInput) ? embeddingInput[0] : embeddingInput
      await logActivityCall(db, input.userId, {
        provider: activityProvider,
        gatewayHost,
        operation: `llm.embedding.error(attempt=${attempt})`,
        baseCostUsd: 0,
        context: embeddingPreview,
        errorMessage: message,
        durationMs: Date.now() - attemptStart,
      })
      if (attempt === maxAttempts) break
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`LLM embedding request failed after ${maxAttempts} attempts`)
}

export type LlmTranscriptionAudio = {
  bytes: Uint8Array
  format: string
}

function sttTranscriptPreview(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  if ('text' in body && typeof (body as { text?: unknown }).text === 'string') {
    return (body as { text: string }).text.slice(0, 200)
  }
  const choices = (body as { choices?: unknown }).choices
  if (Array.isArray(choices) && choices[0] && typeof choices[0] === 'object') {
    const content = (choices[0] as { message?: { content?: unknown } }).message?.content
    if (typeof content === 'string') return content.slice(0, 200)
  }
  return ''
}

/**
 * Speech-to-text via OpenRouter `POST /audio/transcriptions` (OpenAI-compatible JSON body).
 */
export async function llmCreateTranscription(input: {
  userId: string
  model: string
  audio: LlmTranscriptionAudio
}): Promise<unknown> {
  return withPlatformBilling(
    input.userId,
    (body) => requireGatewayReportedCostUsd(body),
    async () => {
      const config = await loadPlatformOpenRouterSttConfig()
      const run = () => llmCreateTranscriptionDedicated(input, config)
      return serialLlmRequestsEnabled() ? runLlmRequestGated(input.userId, run) : run()
    },
  )
}

async function llmCreateTranscriptionDedicated(
  input: { userId: string; model: string; audio: LlmTranscriptionAudio },
  config: ResolvedLlmConfig,
): Promise<unknown> {
  const activityProvider = activityProviderForLlmConfig(config.provider)
  const gatewayHost = gatewayHostFromBaseUrl(config.baseUrl)
  const url = `${config.baseUrl}/audio/transcriptions`
  const audioBase64 = Buffer.from(input.audio.bytes).toString('base64')

  const maxAttempts = 3
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attemptStart = Date.now()
    const db = getDb()
    try {
      logLlmSttRequest(attempt, input.model, input.audio)
      await waitForSttRateLimit(input.userId)
      const timeoutMs = requestTimeoutMs()
      const ac = new AbortController()
      const timeoutHandle = setTimeout(
        () => ac.abort(new Error(`LLM STT request timed out after ${timeoutMs}ms`)),
        timeoutMs,
      )
      let res: Response
      try {
        res = await fetch(url, {
          signal: ac.signal,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: input.model,
            input_audio: {
              data: audioBase64,
              format: input.audio.format,
            },
            temperature: 0,
          }),
        })
      } finally {
        clearTimeout(timeoutHandle)
      }

      const text = await res.text()
      let json: unknown
      try {
        json = JSON.parse(text) as unknown
      } catch {
        json = { raw: text }
      }

      if (!res.ok) {
        const message =
          typeof json === 'object' && json && 'error' in json
            ? JSON.stringify((json as { error?: unknown }).error)
            : text.slice(0, 500)
        throw new Error(`LLM STT HTTP ${res.status}: ${message}`)
      }

      const sttCost = gatewayReportedCostUsdForLog(json)
      logLlmSttResponse(attempt, json)
      await logActivityCall(db, input.userId, {
        provider: activityProvider,
        gatewayHost,
        operation: `llm.stt.success(attempt=${attempt},model=${input.model})`,
        baseCostUsd: sttCost,
        context:
          sttTranscriptPreview(json) ||
          `stt:${input.model}${sttCost === 0 ? ' (usage cost missing from gateway)' : ''}`,
        durationMs: Date.now() - attemptStart,
      })

      return json
    } catch (err) {
      lastError = err
      const message = err instanceof Error ? err.message : String(err)
      await logActivityCall(db, input.userId, {
        provider: activityProvider,
        gatewayHost,
        operation: `llm.stt.error(attempt=${attempt},model=${input.model})`,
        baseCostUsd: 0,
        context: `format=${input.audio.format}`,
        errorMessage: message,
        durationMs: Date.now() - attemptStart,
      })
      if (attempt === maxAttempts) break
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`LLM STT request failed after ${maxAttempts} attempts`)
}
