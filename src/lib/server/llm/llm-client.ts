import { env } from '$env/dynamic/private';
import { getDb } from '$lib/server/db';
import { logActivityCall } from '$lib/server/activity/log-call';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

/** Fallback $/1K until the gateway returns billable usage you map to real pricing. */
const TOKEN_USD_PER_1K = { prompt: 0.0001, completion: 0.00003 } as const;

type TokenUsage = {
	prompt_tokens?: number;
	completion_tokens?: number;
	total_tokens?: number;
};

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

function requireChatRuleId(): string {
	const id = env.LLM_RULE_CHAT?.trim();
	if (!id) {
		throw new Error('LLM_RULE_CHAT is not set (required for chat completions)');
	}
	return id;
}

function requireEmbeddingRuleId(): string {
	const id = env.LLM_RULE_EMBEDDING?.trim();
	if (!id) {
		throw new Error('LLM_RULE_EMBEDDING is not set (required for embedding calls)');
	}
	return id;
}

/**
 * Chat completions: `POST ${LLM_BASE_URL}/api/v1/chat/completions`.
 * Body uses `rule_id` from `LLM_RULE_CHAT` (rule carries model/routing); no `model` field is sent.
 */
export async function llmChatCompletion(input: {
	userId: string;
	messages: ChatMessage[];
	temperature?: number;
}): Promise<unknown> {
	const ruleId = requireChatRuleId();
	const url = `${baseUrl()}/api/v1/chat/completions`;
	const apiKey = env.LLM_API_KEY?.trim();
	if (!apiKey) {
		throw new Error('LLM_API_KEY is not set (required for LLM chat calls)');
	}

	const maxAttempts = 3;
	let lastError: unknown;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const db = getDb();
		try {
			const res = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${apiKey}`
				},
				body: JSON.stringify({
					rule_id: ruleId,
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
				provider: 'llm',
				operation: `llm.chat.success(attempt=${attempt})`,
				baseCostUsd: baseCost
			});

			return json;
		} catch (err) {
			lastError = err;
			await logActivityCall(db, input.userId, {
				provider: 'llm',
				operation: `llm.chat.error(attempt=${attempt})`,
				baseCostUsd: 0
			});
			if (attempt === maxAttempts) break;
		}
	}

	throw lastError instanceof Error
		? lastError
		: new Error(`LLM request failed after ${maxAttempts} attempts`);
}

/**
 * Embeddings: `POST ${LLM_BASE_URL}/api/v1/embeddings` with `rule_id` from `LLM_RULE_EMBEDDING`.
 */
export async function llmCreateEmbeddings(input: { userId: string; input: string | string[] }): Promise<unknown> {
	const ruleId = requireEmbeddingRuleId();
	const url = `${baseUrl()}/api/v1/embeddings`;
	const apiKey = env.LLM_API_KEY?.trim();
	if (!apiKey) {
		throw new Error('LLM_API_KEY is not set (required for LLM embedding calls)');
	}

	const maxAttempts = 3;
	let lastError: unknown;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const db = getDb();
		try {
			const res = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${apiKey}`
				},
				body: JSON.stringify({
					rule_id: ruleId,
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
				provider: 'llm',
				operation: `llm.embedding.success(attempt=${attempt})`,
				baseCostUsd: baseCost
			});

			return json;
		} catch (err) {
			lastError = err;
			await logActivityCall(db, input.userId, {
				provider: 'llm',
				operation: `llm.embedding.error(attempt=${attempt})`,
				baseCostUsd: 0
			});
			if (attempt === maxAttempts) break;
		}
	}

	throw lastError instanceof Error
		? lastError
		: new Error(`LLM embedding request failed after ${maxAttempts} attempts`);
}
