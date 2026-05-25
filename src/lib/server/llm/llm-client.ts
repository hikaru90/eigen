import { env } from '$env/dynamic/private';
import { and, eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { llmProviderConfig, llmActiveProvider } from '$lib/server/db/schema';
import {
	LLM_GATEWAY_ACTIVITY_PROVIDER,
	OPENROUTER_ACTIVITY_PROVIDER
} from '$lib/server/activity/gateway-providers';
import { logActivityCall } from '$lib/server/activity/log-call';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

/** Fallback $/1K until the gateway returns billable usage you map to real pricing. */
const TOKEN_USD_PER_1K = { prompt: 0.0001, completion: 0.00003 } as const;
const EMBEDDING_DIMENSIONS = 1536;

type TokenUsage = {
	prompt_tokens?: number;
	completion_tokens?: number;
	total_tokens?: number;
};

type RoutingConfig = { ruleId?: string; model: string; provider?: Record<string, unknown> };

export type LlmProviderKind = 'eurouter' | 'openrouter';

type ResolvedLlmConfig = {
	provider: LlmProviderKind;
	baseUrl: string;
	apiKey: string;
	/** EUrouter only */
	ruleChat: string | null;
	/** EUrouter only */
	ruleEmbedding: string | null;
	/** OpenRouter only */
	modelChat: string | null;
	/** OpenRouter only */
	modelEmbedding: string | null;
};

/** Hostname from gateway base URL for activity logs (handles missing `https://`). */
function gatewayHostFromBaseUrl(baseUrl: string): string {
	const trimmed = baseUrl.trim().replace(/\/$/, '');
	try {
		return new URL(trimmed).hostname.toLowerCase();
	} catch {
		try {
			return new URL(`https://${trimmed}`).hostname.toLowerCase();
		} catch {
			return trimmed.slice(0, 120);
		}
	}
}

const routingRuleCache = new Map<string, RoutingConfig>();

/**
 * Per-user rate-limit state. Keyed by userId so that concurrent captures from different users
 * do not queue behind each other — only a single user's own successive LLM calls are spaced out.
 * Using a shared global queue previously caused one user's capture to block every other user's
 * LLM access for the duration of their pipeline.
 */
type UserLlmState = { lastRequestAt: number; queue: Promise<void> };
const userLlmState = new Map<string, UserLlmState>();

function getUserLlmState(userId: string): UserLlmState {
	let state = userLlmState.get(userId);
	if (!state) {
		state = { lastRequestAt: 0, queue: Promise.resolve() };
		userLlmState.set(userId, state);
	}
	return state;
}

/**
 * Computes base USD from OpenAI-style `usage` using a single token rate (no per-model env table).
 * Returns 0 when usage is absent or contains no countable tokens — some providers omit the field
 * on valid responses and a missing cost estimate must not abort a successful LLM call.
 */
export function computeTokenCostUsd(usage: TokenUsage | undefined): number {
	if (!usage || typeof usage !== 'object') {
		console.warn('[llm] response missing usage field; logging cost as 0');
		return 0;
	}
	const rates = TOKEN_USD_PER_1K;
	const pi = usage.prompt_tokens;
	const co = usage.completion_tokens;
	if (typeof pi === 'number' && pi >= 0) {
		const coSafe = typeof co === 'number' && co >= 0 ? co : 0;
		return (pi / 1000) * rates.prompt + (coSafe / 1000) * rates.completion;
	}
	const total = usage.total_tokens;
	if (typeof total === 'number' && total >= 0) {
		const blendedPer1k = (rates.prompt + rates.completion) / 2;
		return (total / 1000) * blendedPer1k;
	}
	console.warn('[llm] usage present but no countable tokens; logging cost as 0', usage);
	return 0;
}

function extractUsage(body: unknown): TokenUsage | undefined {
	if (!body || typeof body !== 'object') return undefined;
	return (body as { usage?: TokenUsage }).usage;
}

function minRequestIntervalMs(): number {
	const raw = env.LLM_MIN_REQUEST_INTERVAL_MS?.trim();
	if (!raw) return 1000;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < 0) {
		throw new Error('LLM_MIN_REQUEST_INTERVAL_MS must be a non-negative number');
	}
	return parsed;
}

function requestTimeoutMs(): number {
	const raw = env.LLM_REQUEST_TIMEOUT_MS?.trim();
	if (!raw) return 60_000; // 60 s default
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error('LLM_REQUEST_TIMEOUT_MS must be a positive number');
	}
	return parsed;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForLlmRateLimit(userId: string): Promise<void> {
	const intervalMs = minRequestIntervalMs();
	if (intervalMs === 0) return;

	const state = getUserLlmState(userId);

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
		const now = Date.now();
		const elapsed = now - state.lastRequestAt;
		const waitMs = Math.max(0, intervalMs - elapsed);
		if (waitMs > 0) {
			await sleep(waitMs);
		}
		state.lastRequestAt = Date.now();
		// Slot resolves here — next queued call for this user can now run its spacing check.
	});
	state.queue = slot;
	await slot;
}

/**
 * Loads credentials for a specific LLM provider. DB rows take priority over environment variables.
 */
async function loadLlmProviderConfig(
	userId: string,
	provider: LlmProviderKind
): Promise<ResolvedLlmConfig> {
	const db = getDb();
	const [row] = await db
		.select()
		.from(llmProviderConfig)
		.where(and(eq(llmProviderConfig.userId, userId), eq(llmProviderConfig.provider, provider)))
		.limit(1);

	if (row?.baseUrl && row?.apiKey) {
		return {
			provider,
			baseUrl: row.baseUrl.replace(/\/$/, ''),
			apiKey: row.apiKey,
			ruleChat: row.ruleChat ?? null,
			ruleEmbedding: row.ruleEmbedding ?? null,
			modelChat: row.modelChat ?? null,
			modelEmbedding: row.modelEmbedding ?? null
		};
	}

	if (provider === 'openrouter') {
		const baseUrl = env.OPENROUTER_BASE_URL?.trim();
		const apiKey = env.OPENROUTER_API_KEY?.trim();
		if (!baseUrl) {
			throw new Error(
				'OpenRouter not configured for speech-to-text: set OPENROUTER_BASE_URL or save OpenRouter credentials in Settings → LLM Provider'
			);
		}
		if (!apiKey) {
			throw new Error(
				'OpenRouter not configured for speech-to-text: set OPENROUTER_API_KEY or save OpenRouter credentials in Settings → LLM Provider'
			);
		}
		return {
			provider: 'openrouter',
			baseUrl: baseUrl.replace(/\/$/, ''),
			apiKey,
			ruleChat: null,
			ruleEmbedding: null,
			modelChat: null,
			modelEmbedding: null
		};
	}

	const baseUrl = env.LLM_BASE_URL?.trim();
	const apiKey = env.LLM_API_KEY?.trim();
	if (!baseUrl) {
		throw new Error(
			'LLM not configured: set LLM_BASE_URL in environment or configure via Settings → LLM Provider'
		);
	}
	if (!apiKey) {
		throw new Error(
			'LLM not configured: set LLM_API_KEY in environment or configure via Settings → LLM Provider'
		);
	}

	return {
		provider: 'eurouter',
		baseUrl: baseUrl.replace(/\/$/, ''),
		apiKey,
		ruleChat: env.LLM_RULE_CHAT?.trim() || null,
		ruleEmbedding: env.LLM_RULE_EMBEDDING?.trim() || null,
		modelChat: null,
		modelEmbedding: null
	};
}

/**
 * Loads LLM config for a user. Reads the active provider then fetches that provider's credentials.
 */
async function loadLlmConfig(userId: string): Promise<ResolvedLlmConfig> {
	const db = getDb();
	const [activeRow] = await db
		.select()
		.from(llmActiveProvider)
		.where(eq(llmActiveProvider.userId, userId))
		.limit(1);
	const provider = (activeRow?.provider ?? 'eurouter') as LlmProviderKind;
	return loadLlmProviderConfig(userId, provider);
}

async function resolveRoutingRuleById(ruleId: string, apiKey: string, baseUrl: string): Promise<RoutingConfig> {
	const cached = routingRuleCache.get(ruleId);
	if (cached) return cached;

	const res = await fetch(`${baseUrl}/routing-rules/${ruleId}`, {
		method: 'GET',
		headers: {
			Authorization: `Bearer ${apiKey}`
		}
	});
	const text = await res.text();
	let json: unknown;
	try {
		json = JSON.parse(text) as unknown;
	} catch {
		json = { raw: text };
	}

	if (!res.ok) {
		throw new Error(`Routing rule lookup failed (${ruleId}) HTTP ${res.status}: ${text.slice(0, 500)}`);
	}

	const candidate =
		(typeof json === 'object' && json && 'data' in json
			? (json as { data?: unknown }).data
			: json) ?? {};

	const model =
		typeof (candidate as { model?: unknown }).model === 'string'
			? (candidate as { model: string }).model.trim()
			: '';
	if (!model) {
		throw new Error(`Routing rule ${ruleId} is missing a model`);
	}

	const provider =
		typeof (candidate as { provider?: unknown }).provider === 'object' &&
		(candidate as { provider?: unknown }).provider
			? ((candidate as { provider: Record<string, unknown> }).provider ?? {})
			: undefined;

	const resolved: RoutingConfig = { ruleId, model, ...(provider ? { provider } : {}) };
	routingRuleCache.set(ruleId, resolved);
	return resolved;
}

async function chatRoutingConfig(config: ResolvedLlmConfig): Promise<RoutingConfig> {
	// OpenRouter: use direct model name, no routing rules
	if (config.provider === 'openrouter') {
		const model = config.modelChat?.trim() || env.LLM_MODEL_CHAT?.trim();
		if (!model) {
			throw new Error(
				'OpenRouter chat model not configured: set a chat model name in Settings → LLM Provider'
			);
		}
		return { model };
	}
	// EUrouter: resolve via routing rule or env model override
	const ruleId = config.ruleChat;
	const model = env.LLM_MODEL_CHAT?.trim();
	if (model) return { ...(ruleId ? { ruleId } : {}), model };
	if (ruleId) return resolveRoutingRuleById(ruleId, config.apiKey, config.baseUrl);
	throw new Error(
		'LLM chat rule not configured: set LLM_RULE_CHAT in environment or configure via Settings → LLM Provider'
	);
}

async function embeddingRoutingConfig(config: ResolvedLlmConfig): Promise<RoutingConfig> {
	// OpenRouter: use direct model name, no routing rules
	if (config.provider === 'openrouter') {
		const model = config.modelEmbedding?.trim() || env.LLM_MODEL_EMBEDDING?.trim();
		if (!model) {
			throw new Error(
				'OpenRouter embedding model not configured: set an embedding model name in Settings → LLM Provider'
			);
		}
		return { model };
	}
	// EUrouter: resolve via routing rule or env model override
	const ruleId = config.ruleEmbedding;
	const model = env.LLM_MODEL_EMBEDDING?.trim();
	if (model) return { ...(ruleId ? { ruleId } : {}), model };
	if (ruleId) return resolveRoutingRuleById(ruleId, config.apiKey, config.baseUrl);
	throw new Error(
		'LLM embedding rule not configured: set LLM_RULE_EMBEDDING in environment or configure via Settings → LLM Provider'
	);
}

/**
 * Chat completions: `POST ${baseUrl}/chat/completions`.
 * Body uses `rule_id` from the user's LLM config (DB row) or LLM_RULE_CHAT env var.
 */
export async function llmChatCompletion(input: {
	userId: string;
	messages: ChatMessage[];
	temperature?: number;
	/** Dev/server observability only; appears in logs to disambiguate parallel chat uses. */
	logContext?: string;
}): Promise<unknown> {
	const config = await loadLlmConfig(input.userId);
	const gatewayHost = gatewayHostFromBaseUrl(config.baseUrl);
	const url = `${config.baseUrl}/chat/completions`;
	const routing = await chatRoutingConfig(config);
	const logCtx = (input.logContext?.trim() || 'chat').replace(/\s+/g, '_');

	const maxAttempts = 3;
	let lastError: unknown;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const attemptStart = Date.now();
		const db = getDb();
		try {
			console.info(`[llm.chat:${logCtx}] attempt ${attempt}/${maxAttempts}`, {
				model: routing.model,
				ruleId: routing.ruleId ?? null,
				messageCount: input.messages.length,
				totalChars: input.messages.reduce((n, m) => n + m.content.length, 0)
			});
			await waitForLlmRateLimit(input.userId);
			const fetchStart = Date.now();
			const timeoutMs = requestTimeoutMs();
			const ac = new AbortController();
			const timeoutHandle = setTimeout(() => ac.abort(new Error(`LLM request timed out after ${timeoutMs}ms`)), timeoutMs);
			let res: Response;
			try {
				res = await fetch(url, {
					signal: ac.signal,
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${config.apiKey}`
					},
					body: JSON.stringify({
						...(routing.ruleId ? { rule_id: routing.ruleId } : {}),
						model: routing.model,
						...(routing.provider ? { provider: routing.provider } : {}),
						messages: input.messages,
						...(input.temperature !== undefined ? { temperature: input.temperature } : {})
					})
				});
			} finally {
				clearTimeout(timeoutHandle);
			}

			const text = await res.text();
			let json: unknown;
			try {
				json = JSON.parse(text) as unknown;
			} catch {
				json = { raw: text };
			}

			if (!res.ok) {
				const message =
					typeof json === 'object' && json && 'error' in json
						? JSON.stringify((json as { error?: unknown }).error)
						: text.slice(0, 500);
				throw new Error(`LLM HTTP ${res.status}: ${message}`);
			}

			const usage = extractUsage(json);
			const baseCost = computeTokenCostUsd(usage);
			const attemptMs = Date.now() - attemptStart;
			const fetchMs = Date.now() - fetchStart;
			console.info(`[llm.chat:${logCtx}] gateway response ok`, {
				attempt,
				httpStatus: res.status,
				attemptMs,
				fetchMs,
				prompt_tokens: usage?.prompt_tokens,
				completion_tokens: usage?.completion_tokens,
				total_tokens: usage?.total_tokens
			});
			// Extract first user message for context preview
			const firstUserMessage = input.messages.find(m => m.role === 'user')?.content || '';
			await logActivityCall(db, input.userId, {
				provider: LLM_GATEWAY_ACTIVITY_PROVIDER,
				gatewayHost,
				operation: `llm.chat.success(attempt=${attempt})`,
				baseCostUsd: baseCost,
				context: firstUserMessage,
				durationMs: attemptMs
			});

			return json;
		} catch (err) {
			lastError = err;
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`[llm.chat:${logCtx}] attempt ${attempt} failed`, {
				afterMs: Date.now() - attemptStart,
				message: msg.slice(0, 500)
			});
			// Extract first user message for context preview
			const firstUserMessage = input.messages.find(m => m.role === 'user')?.content || '';
			await logActivityCall(db, input.userId, {
				provider: LLM_GATEWAY_ACTIVITY_PROVIDER,
				gatewayHost,
				operation: `llm.chat.error(attempt=${attempt})`,
				baseCostUsd: 0,
				context: firstUserMessage,
				durationMs: Date.now() - attemptStart
			});
			if (attempt === maxAttempts) break;
		}
	}

	throw lastError instanceof Error
		? lastError
		: new Error(`LLM request failed after ${maxAttempts} attempts`);
}

/**
 * Embeddings: `POST ${baseUrl}/embeddings` with rule_id from the user's LLM config.
 */
export async function llmCreateEmbeddings(input: { userId: string; input: string | string[] }): Promise<unknown> {
	const config = await loadLlmConfig(input.userId);
	const gatewayHost = gatewayHostFromBaseUrl(config.baseUrl);
	const url = `${config.baseUrl}/embeddings`;
	const routing = await embeddingRoutingConfig(config);

	const maxAttempts = 3;
	let lastError: unknown;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const attemptStart = Date.now();
		const db = getDb();
		try {
			await waitForLlmRateLimit(input.userId);
			const embAc = new AbortController();
			const embTimeoutMs = requestTimeoutMs();
			const embTimeoutHandle = setTimeout(() => embAc.abort(new Error(`LLM embedding request timed out after ${embTimeoutMs}ms`)), embTimeoutMs);
			let res: Response;
			try {
				res = await fetch(url, {
					signal: embAc.signal,
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${config.apiKey}`
					},
					body: JSON.stringify({
						...(routing.ruleId ? { rule_id: routing.ruleId } : {}),
						model: routing.model,
						...(routing.provider ? { provider: routing.provider } : {}),
						dimensions: EMBEDDING_DIMENSIONS,
						input: input.input
					})
				});
			} finally {
				clearTimeout(embTimeoutHandle);
			}

			const text = await res.text();
			let json: unknown;
			try {
				json = JSON.parse(text) as unknown;
			} catch {
				json = { raw: text };
			}

			if (!res.ok) {
				const message =
					typeof json === 'object' && json && 'error' in json
						? JSON.stringify((json as { error?: unknown }).error)
						: text.slice(0, 500);
				throw new Error(`LLM HTTP ${res.status}: ${message}`);
			}

			const usage = extractUsage(json);
			const baseCost = computeTokenCostUsd(usage);
			// Extract preview from embedding input
			const embeddingPreview = Array.isArray(input.input)
				? input.input[0]
				: input.input;
			await logActivityCall(db, input.userId, {
				provider: LLM_GATEWAY_ACTIVITY_PROVIDER,
				gatewayHost,
				operation: `llm.embedding.success(attempt=${attempt})`,
				baseCostUsd: baseCost,
				context: embeddingPreview,
				durationMs: Date.now() - attemptStart
			});

			return json;
		} catch (err) {
			lastError = err;
			// Extract preview from embedding input
			const embeddingPreview = Array.isArray(input.input)
				? input.input[0]
				: input.input;
			await logActivityCall(db, input.userId, {
				provider: LLM_GATEWAY_ACTIVITY_PROVIDER,
				gatewayHost,
				operation: `llm.embedding.error(attempt=${attempt})`,
				baseCostUsd: 0,
				context: embeddingPreview,
				durationMs: Date.now() - attemptStart
			});
			if (attempt === maxAttempts) break;
		}
	}

	throw lastError instanceof Error
		? lastError
		: new Error(`LLM embedding request failed after ${maxAttempts} attempts`);
}

export type LlmTranscriptionAudio = {
	bytes: Uint8Array;
	format: string;
	language?: string;
};

function parseUsdCost(value: unknown): number {
	if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
	if (typeof value === 'string') {
		const parsed = Number(value);
		if (Number.isFinite(parsed) && parsed >= 0) return parsed;
	}
	return 0;
}

function extractSttCostUsd(body: unknown): number {
	if (!body || typeof body !== 'object') return 0;
	const root = body as { usage?: unknown; cost?: unknown };
	const fromRoot = parseUsdCost(root.cost);
	if (fromRoot > 0) return fromRoot;
	const usage = root.usage;
	if (!usage || typeof usage !== 'object') return 0;
	const fromUsage = parseUsdCost((usage as { cost?: unknown }).cost);
	if (fromUsage > 0) return fromUsage;
	return computeTokenCostUsd(usage as TokenUsage);
}

function sttTranscriptPreview(body: unknown): string {
	if (!body || typeof body !== 'object') return '';
	if ('text' in body && typeof (body as { text?: unknown }).text === 'string') {
		return (body as { text: string }).text.slice(0, 200);
	}
	const choices = (body as { choices?: unknown }).choices;
	if (Array.isArray(choices) && choices[0] && typeof choices[0] === 'object') {
		const content = (choices[0] as { message?: { content?: unknown } }).message?.content;
		if (typeof content === 'string') return content.slice(0, 200);
	}
	return '';
}

function sttRequestCostUsd(body: unknown): number {
	return extractSttCostUsd(body);
}

/**
 * OpenRouter credentials for speech-to-text. `OPENROUTER_*` env vars take priority over Settings DB.
 */
async function loadOpenRouterSttConfig(userId: string): Promise<ResolvedLlmConfig> {
	const baseUrl = env.OPENROUTER_BASE_URL?.trim();
	const apiKey = env.OPENROUTER_API_KEY?.trim();
	if (baseUrl && apiKey) {
		return {
			provider: 'openrouter',
			baseUrl: baseUrl.replace(/\/$/, ''),
			apiKey,
			ruleChat: null,
			ruleEmbedding: null,
			modelChat: null,
			modelEmbedding: null
		};
	}
	return loadLlmProviderConfig(userId, 'openrouter');
}

/**
 * Speech-to-text via OpenRouter `POST /audio/transcriptions` (OpenAI-compatible JSON body).
 */
export async function llmCreateTranscription(input: {
	userId: string;
	model: string;
	audio: LlmTranscriptionAudio;
}): Promise<unknown> {
	const config = await loadOpenRouterSttConfig(input.userId);
	return llmCreateTranscriptionDedicated(input, config);
}

async function llmCreateTranscriptionDedicated(
	input: { userId: string; model: string; audio: LlmTranscriptionAudio },
	config: ResolvedLlmConfig
): Promise<unknown> {
	const gatewayHost = gatewayHostFromBaseUrl(config.baseUrl);
	const url = `${config.baseUrl}/audio/transcriptions`;
	const audioBase64 = Buffer.from(input.audio.bytes).toString('base64');

	const maxAttempts = 3;
	let lastError: unknown;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const attemptStart = Date.now();
		const db = getDb();
		try {
			await waitForLlmRateLimit(input.userId);
			const timeoutMs = requestTimeoutMs();
			const ac = new AbortController();
			const timeoutHandle = setTimeout(
				() => ac.abort(new Error(`LLM STT request timed out after ${timeoutMs}ms`)),
				timeoutMs
			);
			let res: Response;
			try {
				res = await fetch(url, {
					signal: ac.signal,
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${config.apiKey}`
					},
					body: JSON.stringify({
						model: input.model,
						input_audio: {
							data: audioBase64,
							format: input.audio.format
						},
						...(input.audio.language ? { language: input.audio.language } : {}),
						temperature: 0
					})
				});
			} finally {
				clearTimeout(timeoutHandle);
			}

			const text = await res.text();
			let json: unknown;
			try {
				json = JSON.parse(text) as unknown;
			} catch {
				json = { raw: text };
			}

			if (!res.ok) {
				const message =
					typeof json === 'object' && json && 'error' in json
						? JSON.stringify((json as { error?: unknown }).error)
						: text.slice(0, 500);
				throw new Error(`LLM STT HTTP ${res.status}: ${message}`);
			}

			const sttCost = sttRequestCostUsd(json);
			await logActivityCall(db, input.userId, {
				provider: OPENROUTER_ACTIVITY_PROVIDER,
				gatewayHost,
				operation: `llm.stt.success(attempt=${attempt},model=${input.model})`,
				baseCostUsd: sttCost,
				context:
					sttTranscriptPreview(json) ||
					`stt:${input.model}${sttCost === 0 ? ' (usage cost missing from gateway)' : ''}`,
				durationMs: Date.now() - attemptStart
			});

			return json;
		} catch (err) {
			lastError = err;
			await logActivityCall(db, input.userId, {
				provider: OPENROUTER_ACTIVITY_PROVIDER,
				gatewayHost,
				operation: `llm.stt.error(attempt=${attempt},model=${input.model})`,
				baseCostUsd: 0,
				context: `format=${input.audio.format}`,
				durationMs: Date.now() - attemptStart
			});
			if (attempt === maxAttempts) break;
		}
	}

	throw lastError instanceof Error
		? lastError
		: new Error(`LLM STT request failed after ${maxAttempts} attempts`);
}
