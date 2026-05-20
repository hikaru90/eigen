import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeTokenCostUsd, llmChatCompletion, llmCreateEmbeddings } from './llm-client';

const { mockEnv, logActivityCallMock, getDbMock } = vi.hoisted(() => {
	function makeDbMock() {
		// Returns a chainable Drizzle-style builder that resolves to [] (no DB rows).
		const chain: Record<string, unknown> = {};
		chain.select = () => chain;
		chain.from = () => chain;
		chain.where = () => chain;
		chain.and = () => chain;
		chain.limit = () => Promise.resolve([]);
		return chain;
	}

	return {
		mockEnv: {
			LLM_BASE_URL: 'https://example.test',
			LLM_RULE_CHAT: 'rule-chat',
			LLM_RULE_EMBEDDING: 'rule-embed',
			LLM_MODEL_CHAT: 'gpt-test',
			LLM_MODEL_EMBEDDING: 'text-embedding-3-small',
			LLM_MIN_REQUEST_INTERVAL_MS: '0',
			LLM_API_KEY: 'key-1'
		},
		logActivityCallMock: vi.fn(),
		getDbMock: vi.fn(() => makeDbMock())
	};
});

vi.mock('$env/dynamic/private', () => ({
	env: mockEnv
}));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

vi.mock('$lib/server/activity/log-call', () => ({
	logActivityCall: logActivityCallMock
}));

describe('computeTokenCostUsd', () => {
	it('uses prompt and completion tokens', () => {
		expect(computeTokenCostUsd({ prompt_tokens: 1000, completion_tokens: 1000 })).toBeCloseTo(0.00013);
	});

	it('treats missing completion tokens as zero', () => {
		expect(computeTokenCostUsd({ prompt_tokens: 1000, completion_tokens: -1 })).toBeCloseTo(0.0001);
	});

	it('falls back to total tokens', () => {
		expect(computeTokenCostUsd({ total_tokens: 1000 })).toBeCloseTo(0.000065);
	});

	it('returns 0 when usage is missing', () => {
		expect(computeTokenCostUsd(undefined)).toBe(0);
	});

	it('returns 0 when usage has no countable tokens', () => {
		expect(computeTokenCostUsd({})).toBe(0);
	});
});

function response(ok: boolean, status: number, body: unknown): Response {
	return {
		ok,
		status,
		text: async () => JSON.stringify(body)
	} as unknown as Response;
}

describe('llm client retries', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEnv.LLM_BASE_URL = 'https://example.test';
		mockEnv.LLM_RULE_CHAT = 'rule-chat';
		mockEnv.LLM_RULE_EMBEDDING = 'rule-embed';
		mockEnv.LLM_MODEL_CHAT = 'gpt-test';
		mockEnv.LLM_MODEL_EMBEDDING = 'text-embedding-3-small';
		mockEnv.LLM_MIN_REQUEST_INTERVAL_MS = '0';
		mockEnv.LLM_API_KEY = 'key-1';
	});

	it('chat succeeds and logs cost as 0 when response has no usage field', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => response(true, 200, { choices: [] }))
		);

		await llmChatCompletion({
			userId: 'u1',
			messages: [{ role: 'user', content: 'hello' }]
		});

		expect(logActivityCallMock).toHaveBeenCalledWith(
			expect.anything(),
			'u1',
			expect.objectContaining({
				operation: 'llm.chat.success(attempt=1)',
				baseCostUsd: 0,
				gatewayHost: 'example.test'
			})
		);
	});

	it('chat succeeds and logs activity', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				response(true, 200, {
					usage: { prompt_tokens: 10, completion_tokens: 10 },
					choices: []
				})
			)
		);

		await llmChatCompletion({
			userId: 'u1',
			messages: [{ role: 'user', content: 'hello' }]
		});

		expect(logActivityCallMock).toHaveBeenCalledWith(
			expect.anything(),
			'u1',
			expect.objectContaining({
				provider: 'eurouter',
				operation: 'llm.chat.success(attempt=1)',
				gatewayHost: 'example.test'
			})
		);
	});

	it('chat includes temperature when provided', async () => {
		const fetchMock = vi.fn(async () =>
			response(true, 200, {
				usage: { prompt_tokens: 1, completion_tokens: 1 },
				choices: []
			})
		);
		vi.stubGlobal('fetch', fetchMock);

		await llmChatCompletion({
			userId: 'u1',
			messages: [{ role: 'user', content: 'hello' }],
			temperature: 0.7
		});

		const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string) as {
			temperature?: number;
			model?: string;
		};
		expect(body.temperature).toBe(0.7);
		expect(body.model).toBe('gpt-test');
	});

	it('chat retries exactly three attempts then fails', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => response(false, 500, { error: 'down' })));
		await expect(
			llmChatCompletion({
				userId: 'u1',
				messages: [{ role: 'user', content: 'hello' }]
			})
		).rejects.toThrow(/LLM HTTP 500/);
		expect(fetch).toHaveBeenCalledTimes(3);
	});

	it('fails when chat api key is missing', async () => {
		mockEnv.LLM_API_KEY = '';
		await expect(
			llmChatCompletion({ userId: 'u1', messages: [{ role: 'user', content: 'hello' }] })
		).rejects.toThrow(/LLM_API_KEY/);
	});

	it('embedding succeeds after retries', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(response(false, 500, { error: 'temp' }))
			.mockResolvedValueOnce(response(true, 200, { usage: { total_tokens: 100 }, data: [] }));
		vi.stubGlobal('fetch', fetchMock);

		await llmCreateEmbeddings({ userId: 'u1', input: 'hello' });
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(logActivityCallMock).toHaveBeenCalledWith(
			expect.anything(),
			'u1',
			expect.objectContaining({ operation: 'llm.embedding.error(attempt=1)', gatewayHost: 'example.test' })
		);
		expect(logActivityCallMock).toHaveBeenCalledWith(
			expect.anything(),
			'u1',
			expect.objectContaining({ operation: 'llm.embedding.success(attempt=2)', gatewayHost: 'example.test' })
		);
	});

	it('fails when required env is missing', async () => {
		mockEnv.LLM_API_KEY = '';
		await expect(
			llmCreateEmbeddings({ userId: 'u1', input: 'hello' })
		).rejects.toThrow(/LLM_API_KEY/);
	});

	it('fails when chat model and rule are both missing', async () => {
		mockEnv.LLM_MODEL_CHAT = '';
		mockEnv.LLM_RULE_CHAT = '';
		await expect(
			llmChatCompletion({ userId: 'u1', messages: [{ role: 'user', content: 'hi' }] })
		).rejects.toThrow(/LLM_RULE_CHAT/);
	});

	it('fails when embedding model and rule are both missing', async () => {
		mockEnv.LLM_MODEL_EMBEDDING = '';
		mockEnv.LLM_RULE_EMBEDDING = '';
		await expect(llmCreateEmbeddings({ userId: 'u1', input: 'hello' })).rejects.toThrow(
			/LLM_RULE_EMBEDDING/
		);
	});

	it('uses explicit chat model when provided', async () => {
		mockEnv.LLM_MODEL_CHAT = 'gpt-test';
		const fetchMock = vi.fn(async () =>
			response(true, 200, {
				usage: { prompt_tokens: 1, completion_tokens: 1 },
				choices: []
			})
		);
		vi.stubGlobal('fetch', fetchMock);
		await llmChatCompletion({ userId: 'u1', messages: [{ role: 'user', content: 'hi' }] });
		const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string) as {
			model: string;
			rule_id?: string;
		};
		expect(body.model).toBe('gpt-test');
		expect(body.rule_id).toBe('rule-chat');
	});

	it('resolves embedding model from routing rule when model env missing', async () => {
		mockEnv.LLM_MODEL_EMBEDDING = '';
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				response(true, 200, {
					data: { model: 'text-embedding-3-small', provider: { data_residency: 'EU' } }
				})
			)
			.mockResolvedValueOnce(response(true, 200, { usage: { total_tokens: 5 }, data: [] }));
		vi.stubGlobal('fetch', fetchMock);
		await llmCreateEmbeddings({ userId: 'u1', input: 'hello' });
		const body = JSON.parse((fetchMock.mock.calls[1]?.[1] as RequestInit).body as string) as {
			model: string;
			provider?: Record<string, unknown>;
		};
		expect(body.model).toBe('text-embedding-3-small');
		expect(body.provider).toEqual({ data_residency: 'EU' });
	});

	it('fails when base url is missing', async () => {
		mockEnv.LLM_BASE_URL = '';
		await expect(llmCreateEmbeddings({ userId: 'u1', input: 'hello' })).rejects.toThrow(
			/LLM_BASE_URL/
		);
	});

	it('handles non-json error body', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					({
						ok: false,
						status: 404,
						text: async () => 'route missing'
					}) as unknown as Response
			)
		);
		await expect(llmCreateEmbeddings({ userId: 'u1', input: 'hello' })).rejects.toThrow(
			/LLM HTTP 404/
		);
	});

	it('handles non-json chat error body', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					({
						ok: false,
						status: 500,
						text: async () => 'oops'
					}) as unknown as Response
			)
		);
		await expect(
			llmChatCompletion({ userId: 'u1', messages: [{ role: 'user', content: 'hello' }] })
		).rejects.toThrow(/LLM HTTP 500/);
	});

	it('throws fallback error when fetch throws non-error value', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => Promise.reject('boom')));
		await expect(
			llmChatCompletion({ userId: 'u1', messages: [{ role: 'user', content: 'hello' }] })
		).rejects.toThrow(/failed after 3 attempts/);
	});

	it('embedding throws fallback error on non-error throw', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => Promise.reject('boom')));
		await expect(llmCreateEmbeddings({ userId: 'u1', input: 'hello' })).rejects.toThrow(
			/failed after 3 attempts/
		);
	});

	it('rejects negative or non-numeric LLM_MIN_REQUEST_INTERVAL_MS', async () => {
		mockEnv.LLM_MIN_REQUEST_INTERVAL_MS = '-1';
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				response(true, 200, { usage: { total_tokens: 5 }, data: [] })
			)
		);
		await expect(
			llmCreateEmbeddings({ userId: 'u1', input: 'hello' })
		).rejects.toThrow(/LLM_MIN_REQUEST_INTERVAL_MS must be a non-negative number/);
	});

	it('rate-limits successive calls when interval is configured', async () => {
		vi.resetModules();
		vi.useFakeTimers();
		try {
			mockEnv.LLM_MIN_REQUEST_INTERVAL_MS = '50';
			vi.stubGlobal(
				'fetch',
				vi.fn(async () =>
					response(true, 200, {
						usage: { prompt_tokens: 1, completion_tokens: 1 },
						choices: []
					})
				)
			);
			const { llmChatCompletion: chat } = await import('./llm-client');
			const first = chat({ userId: 'u1', messages: [{ role: 'user', content: 'hi' }] });
			await vi.advanceTimersByTimeAsync(0);
			const second = chat({ userId: 'u1', messages: [{ role: 'user', content: 'hi' }] });
			await vi.advanceTimersByTimeAsync(50);
			await first;
			await second;
			expect(fetch).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it('resolves chat routing rule via /routing-rules when model env is empty', async () => {
		vi.resetModules();
		mockEnv.LLM_MODEL_CHAT = '';
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(response(true, 200, { data: { model: 'rule-model' } }))
			.mockResolvedValueOnce(
				response(true, 200, {
					usage: { prompt_tokens: 1, completion_tokens: 1 },
					choices: []
				})
			);
		vi.stubGlobal('fetch', fetchMock);
		const { llmChatCompletion: chat } = await import('./llm-client');
		await chat({ userId: 'u1', messages: [{ role: 'user', content: 'hi' }] });
		const body = JSON.parse((fetchMock.mock.calls[1]?.[1] as RequestInit).body as string) as {
			model: string;
			rule_id?: string;
		};
		expect(body.model).toBe('rule-model');
		expect(body.rule_id).toBe('rule-chat');
	});

	it('throws when routing rule lookup fails', async () => {
		vi.resetModules();
		mockEnv.LLM_MODEL_EMBEDDING = '';
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => response(false, 404, { error: 'no such rule' }))
		);
		const { llmCreateEmbeddings: embed } = await import('./llm-client');
		await expect(embed({ userId: 'u1', input: 'hi' })).rejects.toThrow(/Routing rule lookup failed/);
	});

	it('omits rule_id from chat body when only LLM_MODEL_CHAT is set', async () => {
		mockEnv.LLM_RULE_CHAT = '';
		const fetchMock = vi.fn(async () =>
			response(true, 200, {
				usage: { prompt_tokens: 1, completion_tokens: 1 },
				choices: []
			})
		);
		vi.stubGlobal('fetch', fetchMock);
		await llmChatCompletion({ userId: 'u1', messages: [{ role: 'user', content: 'hi' }] });
		const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string) as {
			model: string;
			rule_id?: string;
		};
		expect(body.model).toBe('gpt-test');
		expect(body.rule_id).toBeUndefined();
	});

	it('omits rule_id from embedding body when only LLM_MODEL_EMBEDDING is set', async () => {
		mockEnv.LLM_RULE_EMBEDDING = '';
		const fetchMock = vi.fn(async () =>
			response(true, 200, { usage: { total_tokens: 1 }, data: [] })
		);
		vi.stubGlobal('fetch', fetchMock);
		await llmCreateEmbeddings({ userId: 'u1', input: 'hello' });
		const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string) as {
			model: string;
			rule_id?: string;
		};
		expect(body.model).toBe('text-embedding-3-small');
		expect(body.rule_id).toBeUndefined();
	});

	it('throws when routing rule response is missing a model', async () => {
		vi.resetModules();
		mockEnv.LLM_MODEL_EMBEDDING = '';
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					({
						ok: true,
						status: 200,
						text: async () => 'not json at all'
					}) as unknown as Response
			)
		);
		const { llmCreateEmbeddings: embed } = await import('./llm-client');
		await expect(embed({ userId: 'u1', input: 'hi' })).rejects.toThrow(/missing a model/);
	});
});
