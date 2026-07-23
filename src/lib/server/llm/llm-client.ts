import { AsyncLocalStorage } from 'node:async_hooks'
import { env } from '$env/dynamic/private'
import { and, eq } from 'drizzle-orm'
import { getDb, withDbUser } from '$lib/server/db'
import { llmProviderConfig, llmActiveProvider } from '$lib/server/db/schema'
import { activityProviderForLlmConfig } from '$lib/server/activity/gateway-providers'
import { logActivityCall } from '$lib/server/activity/log-call'
import { resolveBillingUserId } from '$lib/server/billing/context'
import { isByokBilling } from '$lib/server/billing/preferences'
import {
  loadPlatformLlmConfig,
  loadPlatformOpenRouterSttConfig,
} from '$lib/server/billing/platform-llm'
import { withPlatformBilling } from '$lib/server/billing/usage-gate'
import {
  gatewayReportedCostUsdForLog,
  requireGatewayReportedCostUsd,
  type TokenUsage,
} from '$lib/server/llm/gateway-cost'
import { sanitizeChatMessages } from '$lib/server/observability/strip-embeddings'
import { isGraphScaleQuiet } from '$lib/server/observability/graph-scale-quiet'
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { LlmHttpError } from '$lib/server/llm/errors'
import {
  assertEurouterGatewayConfigured,
  routingRuleLookupErrorMessage,
} from '$lib/server/llm/llm-config-guard'

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }
export {
  extractGatewayReportedCostUsd,
  gatewayReportedCostUsdForLog,
  requireGatewayReportedCostUsd,
} from '$lib/server/llm/gateway-cost'

type RoutingConfig = { ruleId?: string; model: string; provider?: Record<string, unknown> }

export type { LlmProviderKind, ResolvedLlmConfig } from '$lib/server/llm/types'
import type { LlmProviderKind, ResolvedLlmConfig } from '$lib/server/llm/types'

const EMBEDDING_DIMENSIONS = 1536

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

const routingRuleCache = new Map<string, RoutingConfig>()

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
  audio: { bytes: Uint8Array; format: string; language?: string },
): void {
  if (isGraphScaleQuiet()) return
  console.log(
    `[llm.stt] request attempt ${attempt}/${3} model=${model} format=${audio.format} bytes=${audio.bytes.byteLength}${audio.language ? ` language=${audio.language}` : ''}`,
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
 * Loads credentials for a specific LLM provider. DB rows take priority over environment variables.
 */
async function loadLlmProviderConfig(
  userId: string,
  provider: LlmProviderKind,
): Promise<ResolvedLlmConfig> {
  const row = await withDbUser(userId, async (db) => {
    const [loaded] = await db
      .select()
      .from(llmProviderConfig)
      .where(and(eq(llmProviderConfig.userId, userId), eq(llmProviderConfig.provider, provider)))
      .limit(1)
    if (!loaded?.baseUrl) return null

    const apiKey = loaded.apiKeyEncrypted
      ? await decryptTenantValue({
          userId,
          table: 'llm_provider_config',
          column: 'api_key',
          ciphertext: loaded.apiKeyEncrypted,
        })
      : (loaded.apiKey ?? '')
    if (!apiKey.trim()) return null

    return { ...loaded, apiKey }
  })

  if (row?.baseUrl && row.apiKey) {
    const baseUrl = row.baseUrl.replace(/\/$/, '')
    const ruleChat = row.ruleChat?.trim() || null
    const ruleEmbedding = row.ruleEmbedding?.trim() || null
    if (provider === 'eurouter') {
      assertEurouterGatewayConfigured({
        baseUrl,
        ruleChat,
        ruleEmbedding,
        context: 'byok',
      })
    }
    return {
      provider,
      baseUrl,
      apiKey: row.apiKey,
      ruleChat,
      ruleEmbedding,
      modelChat: row.modelChat?.trim() || null,
      modelEmbedding: row.modelEmbedding?.trim() || null,
    }
  }

  if (provider === 'openrouter') {
    const baseUrl = env.OPENROUTER_BASE_URL?.trim()
    const apiKey = env.OPENROUTER_API_KEY?.trim()
    if (!baseUrl) {
      throw new Error(
        'OpenRouter not configured for speech-to-text: set OPENROUTER_BASE_URL or save OpenRouter credentials in Settings → LLM Provider',
      )
    }
    if (!apiKey) {
      throw new Error(
        'OpenRouter not configured for speech-to-text: set OPENROUTER_API_KEY or save OpenRouter credentials in Settings → LLM Provider',
      )
    }
    return {
      provider: 'openrouter',
      baseUrl: baseUrl.replace(/\/$/, ''),
      apiKey,
      ruleChat: null,
      ruleEmbedding: null,
      modelChat: null,
      modelEmbedding: null,
    }
  }

  const baseUrl = env.LLM_BASE_URL?.trim()
  const apiKey = env.LLM_API_KEY?.trim()
  if (!baseUrl) {
    throw new Error(
      'LLM not configured: set LLM_BASE_URL in environment or configure via Settings → LLM Provider',
    )
  }
  if (!apiKey) {
    throw new Error(
      'LLM not configured: set LLM_API_KEY in environment or configure via Settings → LLM Provider',
    )
  }

  const ruleChat = env.LLM_RULE_CHAT?.trim() || null
  const ruleEmbedding = env.LLM_RULE_EMBEDDING?.trim() || null
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '')
  assertEurouterGatewayConfigured({
    baseUrl: normalizedBaseUrl,
    ruleChat,
    ruleEmbedding,
    context: 'byok',
  })

  return {
    provider: 'eurouter',
    baseUrl: normalizedBaseUrl,
    apiKey,
    ruleChat,
    ruleEmbedding,
    modelChat: null,
    modelEmbedding: null,
  }
}

/** Active provider row + DB/env credentials (EUrouter or OpenRouter BYOK shapes). */
async function resolveActiveProviderLlmConfig(userId: string): Promise<ResolvedLlmConfig> {
  const [activeRow] = await withDbUser(userId, async (db) =>
    db.select().from(llmActiveProvider).where(eq(llmActiveProvider.userId, userId)).limit(1),
  )
  const provider = (activeRow?.provider ?? 'eurouter') as LlmProviderKind
  return loadLlmProviderConfig(userId, provider)
}

/**
 * Loads LLM config for billing (gateway keys + active provider preference).
 * Uses resolveBillingUserId so eval tenants bill/configure via the operator, not the
 * ephemeral eval user. Unrelated to tenant envelope encryption (thought/BYOK-at-rest DEK).
 */
async function loadLlmConfig(userId: string): Promise<ResolvedLlmConfig> {
  const billingUserId = resolveBillingUserId(userId)
  if (await isByokBilling(billingUserId)) {
    return resolveActiveProviderLlmConfig(billingUserId)
  }
  return loadPlatformLlmConfig(billingUserId)
}

async function resolveRoutingRuleById(
  ruleId: string,
  apiKey: string,
  baseUrl: string,
): Promise<RoutingConfig> {
  const cached = routingRuleCache.get(ruleId)
  if (cached) return cached

  const res = await fetch(`${baseUrl}/routing-rules/${ruleId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  })
  const text = await res.text()
  let json: unknown
  try {
    json = JSON.parse(text) as unknown
  } catch {
    json = { raw: text }
  }

  if (!res.ok) {
    throw new Error(
      routingRuleLookupErrorMessage({
        ruleId,
        baseUrl,
        status: res.status,
        bodyPreview: text,
      }),
    )
  }

  const candidate =
    (typeof json === 'object' && json && 'data' in json
      ? (json as { data?: unknown }).data
      : json) ?? {}

  const model =
    typeof (candidate as { model?: unknown }).model === 'string'
      ? (candidate as { model: string }).model.trim()
      : ''
  if (!model) {
    throw new Error(`Routing rule ${ruleId} is missing a model`)
  }

  const provider =
    typeof (candidate as { provider?: unknown }).provider === 'object' &&
    (candidate as { provider?: unknown }).provider
      ? ((candidate as { provider: Record<string, unknown> }).provider ?? {})
      : undefined

  const resolved: RoutingConfig = { ruleId, model, ...(provider ? { provider } : {}) }
  routingRuleCache.set(ruleId, resolved)
  return resolved
}

async function chatRoutingConfig(
  config: ResolvedLlmConfig,
  ruleOverride?: string,
): Promise<RoutingConfig> {
  // OpenRouter: use direct model name, no routing rules
  if (config.provider === 'openrouter') {
    const model = config.modelChat?.trim() || env.LLM_MODEL_CHAT?.trim()
    if (!model) {
      throw new Error(
        'OpenRouter chat model not configured: set a chat model name in Settings → LLM Provider',
      )
    }
    return { model }
  }
  // EUrouter: resolve via routing rule or env model override
  const ruleId = ruleOverride?.trim() || config.ruleChat
  const model = env.LLM_MODEL_CHAT?.trim()
  if (model) return { ...(ruleId ? { ruleId } : {}), model }
  if (ruleId) return resolveRoutingRuleById(ruleId, config.apiKey, config.baseUrl)
  throw new Error(
    'LLM chat rule not configured: set LLM_RULE_CHAT in environment or configure via Settings → LLM Provider',
  )
}

async function embeddingRoutingConfig(config: ResolvedLlmConfig): Promise<RoutingConfig> {
  // OpenRouter: use direct model name, no routing rules
  if (config.provider === 'openrouter') {
    const model = config.modelEmbedding?.trim() || env.LLM_MODEL_EMBEDDING?.trim()
    if (!model) {
      throw new Error(
        'OpenRouter embedding model not configured: set an embedding model name in Settings → LLM Provider',
      )
    }
    return { model }
  }
  // EUrouter: resolve via routing rule or env model override
  const ruleId = config.ruleEmbedding
  const model = env.LLM_MODEL_EMBEDDING?.trim()
  if (model) return { ...(ruleId ? { ruleId } : {}), model }
  if (ruleId) return resolveRoutingRuleById(ruleId, config.apiKey, config.baseUrl)
  throw new Error(
    'LLM embedding rule not configured: set LLM_RULE_EMBEDDING in environment or configure via Settings → LLM Provider',
  )
}

/**
 * Chat completions: `POST ${baseUrl}/chat/completions`.
 * Body uses `rule_id` from the user's LLM config (DB row) or LLM_RULE_CHAT env var.
 */
export async function llmChatCompletion(input: {
  userId: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  /** Dev/server observability only; appears in logs to disambiguate parallel chat uses. */
  logContext?: string
  /** Override chat routing rule (e.g. LLM_RULE_ROUTER for the agent router judge). */
  routingRuleId?: string
  /** OpenAI-compatible JSON object mode — gateway must support response_format. */
  responseFormat?: 'json_object'
}): Promise<unknown> {
  return withPlatformBilling(
    input.userId,
    (body) => requireGatewayReportedCostUsd(body),
    () =>
      serialLlmRequestsEnabled()
        ? runLlmRequestGated(input.userId, () => llmChatCompletionInner(input))
        : llmChatCompletionInner(input),
  )
}

async function llmChatCompletionInner(input: {
  userId: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  logContext?: string
  routingRuleId?: string
  responseFormat?: 'json_object'
}): Promise<unknown> {
  const config = await loadLlmConfig(input.userId)
  const activityProvider = activityProviderForLlmConfig(config.provider)
  const gatewayHost = gatewayHostFromBaseUrl(config.baseUrl)
  const url = `${config.baseUrl}/chat/completions`
  const routing = await chatRoutingConfig(config, input.routingRuleId)
  const logCtx = (input.logContext?.trim() || 'chat').replace(/\s+/g, '_')
  const messages = sanitizeChatMessages(input.messages)

  const maxAttempts = 3
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attemptStart = Date.now()
    const db = getDb()
    try {
      if (!isGraphScaleQuiet()) {
        console.info(`[llm.chat:${logCtx}] attempt ${attempt}/${maxAttempts}`, {
          model: routing.model,
          ruleId: routing.ruleId ?? null,
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
          body: JSON.stringify({
            ...(routing.ruleId ? { rule_id: routing.ruleId } : {}),
            model: routing.model,
            ...(routing.provider ? { provider: routing.provider } : {}),
            messages,
            ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
            ...(input.maxTokens !== undefined ? { max_tokens: input.maxTokens } : {}),
            ...(input.responseFormat === 'json_object'
              ? { response_format: { type: 'json_object' } }
              : {}),
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
      const firstUserMessage = input.messages.find((m) => m.role === 'user')?.content || ''
      await logActivityCall(db, input.userId, {
        provider: activityProvider,
        gatewayHost,
        operation: `llm.chat.${logCtx}.success(attempt=${attempt})`,
        baseCostUsd: baseCost,
        context: firstUserMessage,
        durationMs: attemptMs,
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
      const firstUserMessage = input.messages.find((m) => m.role === 'user')?.content || ''
      await logActivityCall(db, input.userId, {
        provider: activityProvider,
        gatewayHost,
        operation: `llm.chat.${logCtx}.error(attempt=${attempt})`,
        baseCostUsd: 0,
        context: firstUserMessage,
        durationMs: Date.now() - attemptStart,
      })
      if (attempt === maxAttempts) break
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`LLM request failed after ${maxAttempts} attempts`)
}

/**
 * Embeddings: `POST ${baseUrl}/embeddings` with rule_id from the user's LLM config.
 */
export async function llmCreateEmbeddings(input: {
  userId: string
  input: string | string[]
}): Promise<unknown> {
  return withPlatformBilling(
    input.userId,
    (body) => requireGatewayReportedCostUsd(body),
    () =>
      serialLlmRequestsEnabled()
        ? runLlmRequestGated(input.userId, () => llmCreateEmbeddingsInner(input))
        : llmCreateEmbeddingsInner(input),
  )
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

  const maxAttempts = 3
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attemptStart = Date.now()
    const db = getDb()
    try {
      logLlmEmbeddingRequest(attempt, input.input)
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
          body: JSON.stringify({
            ...(routing.ruleId ? { rule_id: routing.ruleId } : {}),
            model: routing.model,
            ...(routing.provider ? { provider: routing.provider } : {}),
            dimensions: EMBEDDING_DIMENSIONS,
            input: input.input,
          }),
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
      const embeddingPreview = Array.isArray(input.input) ? input.input[0] : input.input
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
      // Extract preview from embedding input
      const embeddingPreview = Array.isArray(input.input) ? input.input[0] : input.input
      await logActivityCall(db, input.userId, {
        provider: activityProvider,
        gatewayHost,
        operation: `llm.embedding.error(attempt=${attempt})`,
        baseCostUsd: 0,
        context: embeddingPreview,
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
  language?: string
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
 * OpenRouter credentials for speech-to-text.
 * — Platform credits: Eigen service account (`SERVICE_API_KEY_OPENROUTER`).
 * — BYOK: user DB credentials first, then deployment `OPENROUTER_*` env fallback (same as chat).
 */
async function loadOpenRouterSttConfig(userId: string): Promise<ResolvedLlmConfig> {
  const billingUserId = resolveBillingUserId(userId)
  if (await isByokBilling(billingUserId)) {
    return loadLlmProviderConfig(billingUserId, 'openrouter')
  }
  return loadPlatformOpenRouterSttConfig()
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
      const config = await loadOpenRouterSttConfig(input.userId)
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
            ...(input.audio.language ? { language: input.audio.language } : {}),
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
      await logActivityCall(db, input.userId, {
        provider: activityProvider,
        gatewayHost,
        operation: `llm.stt.error(attempt=${attempt},model=${input.model})`,
        baseCostUsd: 0,
        context: `format=${input.audio.format}`,
        durationMs: Date.now() - attemptStart,
      })
      if (attempt === maxAttempts) break
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`LLM STT request failed after ${maxAttempts} attempts`)
}
