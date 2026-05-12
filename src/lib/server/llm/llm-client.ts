import { env } from '$env/dynamic/private';
import { getDb } from '$lib/server/db';
import { LLM_GATEWAY_ACTIVITY_PROVIDER } from '$lib/server/activity/gateway-providers';
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

const routingRuleCache = new Map<string, RoutingConfig>();
let lastLlmRequestAt = 0;
let llmRequestQueue: Promise<void> = Promise.resolve();

/**
 * Computes base USD from OpenAI-style `usage` using a single token rate (no per-model env table).
 */
export function computeTokenCostUsd(usage: TokenUsage | undefined): number {
	if (!usage || typeof usage !== 'object') {
		throw new Error('LLM response missing usage; cannot compute cost for activity log');
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
	throw new Error(
		'LLM usage missing countable tokens (need prompt_tokens+completion_tokens or total_tokens) for cost calculation'
	);
}

function baseUrl(): string {
	const u = env.LLM_BASE_URL?.trim();
	if (!u) {
		throw new Error('LLM_BASE_URL is not set (required for LLM calls)');
	}
	return u.replace(/\/$/, '');
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

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForLlmRateLimit(): Promise<void> {
	const intervalMs = minRequestIntervalMs();
	if (intervalMs === 0) return;

	llmRequestQueue = llmRequestQueue.then(async () => {
		const now = Date.now();
		const elapsed = now - lastLlmRequestAt;
		const waitMs = Math.max(0, intervalMs - elapsed);
		if (waitMs > 0) {
			await sleep(waitMs);
		}
		lastLlmRequestAt = Date.now();
	});
	await llmRequestQueue;
}

async function resolveRoutingRuleById(ruleId: string, apiKey: string): Promise<RoutingConfig> {
	const cached = routingRuleCache.get(ruleId);
	if (cached) return cached;

	const res = await fetch(`${baseUrl()}/routing-rules/${ruleId}`, {
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

async function chatRoutingConfig(apiKey: string): Promise<RoutingConfig> {
	const ruleId = env.LLM_RULE_CHAT?.trim();
	const model = env.LLM_MODEL_CHAT?.trim();
	if (model) return { ...(ruleId ? { ruleId } : {}), model };
	if (ruleId) return resolveRoutingRuleById(ruleId, apiKey);
	throw new Error('LLM_MODEL_CHAT or LLM_RULE_CHAT must be set (required for chat completions)');
}

async function embeddingRoutingConfig(apiKey: string): Promise<RoutingConfig> {
	const ruleId = env.LLM_RULE_EMBEDDING?.trim();
	const model = env.LLM_MODEL_EMBEDDING?.trim();
	if (model) return { ...(ruleId ? { ruleId } : {}), model };
	if (ruleId) return resolveRoutingRuleById(ruleId, apiKey);
	throw new Error(
		'LLM_MODEL_EMBEDDING or LLM_RULE_EMBEDDING must be set (required for embedding calls)'
	);
}

/**
 * Chat completions: `POST ${LLM_BASE_URL}/chat/completions`.
 * Body uses `rule_id` from `LLM_RULE_CHAT` (rule carries model/routing); no `model` field is sent.
 */
export async function llmChatCompletion(input: {
	userId: string;
	messages: ChatMessage[];
	temperature?: number;
}): Promise<unknown> {
	const url = `${baseUrl()}/chat/completions`;
	const apiKey = env.LLM_API_KEY?.trim();
	if (!apiKey) {
		throw new Error('LLM_API_KEY is not set (required for LLM chat calls)');
	}
	const routing = await chatRoutingConfig(apiKey);

	const maxAttempts = 3;
	let lastError: unknown;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const attemptStart = Date.now();
		const db = getDb();
		try {
			await waitForLlmRateLimit();
			const res = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${apiKey}`
				},
				body: JSON.stringify({
					...(routing.ruleId ? { rule_id: routing.ruleId } : {}),
					model: routing.model,
					...(routing.provider ? { provider: routing.provider } : {}),
					messages: input.messages,
					...(input.temperature !== undefined ? { temperature: input.temperature } : {})
				})
			});

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
			await logActivityCall(db, input.userId, {
				provider: LLM_GATEWAY_ACTIVITY_PROVIDER,
				operation: `llm.chat.success(attempt=${attempt})`,
				baseCostUsd: baseCost,
				durationMs: Date.now() - attemptStart
			});

			return json;
		} catch (err) {
			lastError = err;
			await logActivityCall(db, input.userId, {
				provider: LLM_GATEWAY_ACTIVITY_PROVIDER,
				operation: `llm.chat.error(attempt=${attempt})`,
				baseCostUsd: 0,
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
 * Embeddings: `POST ${LLM_BASE_URL}/embeddings` with `rule_id` from `LLM_RULE_EMBEDDING`.
 */
export async function llmCreateEmbeddings(input: { userId: string; input: string | string[] }): Promise<unknown> {
	const url = `${baseUrl()}/embeddings`;
	const apiKey = env.LLM_API_KEY?.trim();
	if (!apiKey) {
		throw new Error('LLM_API_KEY is not set (required for LLM embedding calls)');
	}
	const routing = await embeddingRoutingConfig(apiKey);

	const maxAttempts = 3;
	let lastError: unknown;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const attemptStart = Date.now();
		const db = getDb();
		try {
			await waitForLlmRateLimit();
			const res = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${apiKey}`
				},
				body: JSON.stringify({
					...(routing.ruleId ? { rule_id: routing.ruleId } : {}),
					model: routing.model,
					...(routing.provider ? { provider: routing.provider } : {}),
					dimensions: EMBEDDING_DIMENSIONS,
					input: input.input
				})
			});

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
			await logActivityCall(db, input.userId, {
				provider: LLM_GATEWAY_ACTIVITY_PROVIDER,
				operation: `llm.embedding.success(attempt=${attempt})`,
				baseCostUsd: baseCost,
				durationMs: Date.now() - attemptStart
			});

			return json;
		} catch (err) {
			lastError = err;
			await logActivityCall(db, input.userId, {
				provider: LLM_GATEWAY_ACTIVITY_PROVIDER,
				operation: `llm.embedding.error(attempt=${attempt})`,
				baseCostUsd: 0,
				durationMs: Date.now() - attemptStart
			});
			if (attempt === maxAttempts) break;
		}
	}

	throw lastError instanceof Error
		? lastError
		: new Error(`LLM embedding request failed after ${maxAttempts} attempts`);
}
