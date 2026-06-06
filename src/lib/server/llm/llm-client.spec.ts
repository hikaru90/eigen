import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	llmChatCompletion,
	llmCreateEmbeddings,
	llmCreateTranscription
} from './llm-client';

const { mockEnv, logActivityCallMock, getDbMock, decryptTenantValueMock } = vi.hoisted(() => {
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
			LLM_API_KEY: 'key-1',
			SERVICE_API_KEY_EUROUTER: 'service-eurouter-key',
			OPENROUTER_BASE_URL: 'https://openrouter.example/api/v1',
			OPENROUTER_API_KEY: 'openrouter-key',
			SERVICE_API_KEY_OPENROUTER: 'service-openrouter-key'
		},
		logActivityCallMock: vi.fn(),
		getDbMock: vi.fn(() => makeDbMock()),
		decryptTenantValueMock: vi.fn(async () => 'decrypted-key')
	};
});

vi.mock('$env/dynamic/private', () => ({
	env: mockEnv
}));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock,
	withDbUser: async (_userId: string, fn: (db: ReturnType<typeof getDbMock>) => Promise<unknown>) =>
		fn(getDbMock())
}));

vi.mock('$lib/server/activity/log-call', () => ({
	logActivityCall: logActivityCallMock
}));

vi.mock('$lib/server/billing/preferences', () => ({
	isByokBilling: vi.fn(async () => true)
}));

vi.mock('$lib/server/billing/usage-gate', () => ({
	withPlatformBilling: vi.fn(async (_userId, _settle, fn) => fn())
}));

vi.mock('$lib/server/crypto/tenant-encryption', () => ({
	decryptTenantValue: decryptTenantValueMock
}));

function mockSequentialDbLimitResults(...results: unknown[][]) {
	let index = 0;
	const chain: Record<string, unknown> = {};
	chain.select = () => chain;
	chain.from = () => chain;
	chain.where = () => chain;
	chain.limit = () => {
		const rows = results[index] ?? [];
		index += 1;
		return Promise.resolve(rows);
	};
	getDbMock.mockReturnValue(chain);
	return chain;
}

function fetchThatWaitsForAbort(): ReturnType<typeof vi.fn> {
	return vi.fn((_url: unknown, init?: RequestInit) => {
		return new Promise((_resolve, reject) => {
			const signal = init?.signal;
			if (signal?.aborted) {
				reject(signal.reason);
				return;
			}
			signal?.addEventListener('abort', () => reject(signal.reason));
		});
	});
}

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
		mockEnv.LLM_REQUEST_TIMEOUT_MS = '';
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
				operation: 'llm.chat.chat.success(attempt=1)',
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
				operation: 'llm.chat.chat.success(attempt=1)',
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

	it('parses gateway host from bare hostnames and invalid URLs', async () => {
		mockEnv.LLM_BASE_URL = 'api.example.test/';
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => response(true, 200, { choices: [{ message: { content: 'ok' } }] }))
		);
		await llmChatCompletion({ userId: 'u1', messages: [{ role: 'user', content: 'hello' }] });
		expect(logActivityCallMock).toHaveBeenCalledWith(
			expect.anything(),
			'u1',
			expect.objectContaining({ gatewayHost: 'api.example.test' })
		);
	});

	it('rejects invalid LLM_REQUEST_TIMEOUT_MS', async () => {
		mockEnv.LLM_REQUEST_TIMEOUT_MS = '0';
		await expect(
			llmChatCompletion({ userId: 'u1', messages: [{ role: 'user', content: 'hello' }] })
		).rejects.toThrow(/LLM_REQUEST_TIMEOUT_MS/);
	});

	it('rejects invalid LLM_MIN_REQUEST_INTERVAL_MS', async () => {
		mockEnv.LLM_MIN_REQUEST_INTERVAL_MS = 'not-a-number';
		await expect(
			llmChatCompletion({ userId: 'u1', messages: [{ role: 'user', content: 'hello' }] })
		).rejects.toThrow(/LLM_MIN_REQUEST_INTERVAL_MS/);
	});

	it('falls back to trimmed base URL when gateway host cannot be parsed', async () => {
		mockEnv.LLM_BASE_URL = '%%%not-a-valid-url%%%';
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => response(true, 200, { choices: [] }))
		);
		await llmChatCompletion({ userId: 'u1', messages: [{ role: 'user', content: 'hello' }] });
		expect(logActivityCallMock).toHaveBeenCalledWith(
			expect.anything(),
			'u1',
			expect.objectContaining({ gatewayHost: '%%%not-a-valid-url%%%' })
		);
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

	it('throws when routing rule response is missing a model from non-json body', async () => {
		vi.resetModules();
		mockEnv.LLM_MODEL_EMBEDDING = '';
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => response(true, 200, { data: {} }))
		);
		const { llmCreateEmbeddings: embed } = await import('./llm-client');
		await expect(embed({ userId: 'u1', input: 'hi' })).rejects.toThrow(/missing a model/);
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

describe('llmCreateTranscription', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEnv.LLM_REQUEST_TIMEOUT_MS = '';
		mockEnv.LLM_MIN_REQUEST_INTERVAL_MS = '0';
		mockEnv.OPENROUTER_BASE_URL = 'https://openrouter.example/api/v1';
		mockEnv.OPENROUTER_API_KEY = 'openrouter-key';
		mockEnv.SERVICE_API_KEY_OPENROUTER = 'service-openrouter-key';
	});

	it('BYOK uses saved OpenRouter credentials for speech-to-text', async () => {
		const { isByokBilling } = await import('$lib/server/billing/preferences');
		vi.mocked(isByokBilling).mockResolvedValue(true);
		const fetchMock = vi.fn(async () => response(true, 200, { text: 'from db', usage: { cost: 0.001 } }));
		vi.stubGlobal('fetch', fetchMock);
		getDbMock.mockReturnValueOnce({
			select: () => ({
				from: () => ({
					where: () => ({
						limit: () =>
							Promise.resolve([
								{
									provider: 'openrouter',
									baseUrl: 'https://db-openrouter.example/api/v1',
									apiKey: 'db-key',
									apiKeyEncrypted: null,
									ruleChat: null,
									ruleEmbedding: null,
									modelChat: null,
									modelEmbedding: null
								}
							])
					})
				})
			})
		});
		await llmCreateTranscription({
			userId: 'u1',
			model: 'qwen/qwen3-asr-flash-2026-02-10',
			audio: { bytes: new Uint8Array([1]), format: 'webm' }
		});
		expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
			'https://db-openrouter.example/api/v1/audio/transcriptions'
		);
		const auth = (fetchMock.mock.calls[0]?.[1] as RequestInit)?.headers as Record<string, string>;
		expect(auth.Authorization).toBe('Bearer db-key');
	});

	it('BYOK falls back to OPENROUTER_* env when no DB credentials', async () => {
		const { isByokBilling } = await import('$lib/server/billing/preferences');
		vi.mocked(isByokBilling).mockResolvedValue(true);
		const fetchMock = vi.fn(async () => response(true, 200, { text: 'from env', usage: { cost: 0.001 } }));
		vi.stubGlobal('fetch', fetchMock);
		await llmCreateTranscription({
			userId: 'u1',
			model: 'qwen/qwen3-asr-flash-2026-02-10',
			audio: { bytes: new Uint8Array([1]), format: 'webm' }
		});
		expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
			'https://openrouter.example/api/v1/audio/transcriptions'
		);
	});

	it('platform credits uses SERVICE_API_KEY_OPENROUTER for speech-to-text', async () => {
		const { isByokBilling } = await import('$lib/server/billing/preferences');
		vi.mocked(isByokBilling).mockResolvedValue(false);
		const fetchMock = vi.fn(async () =>
			response(true, 200, { text: 'platform', usage: { cost: 0.001 } })
		);
		vi.stubGlobal('fetch', fetchMock);
		await llmCreateTranscription({
			userId: 'u1',
			model: 'qwen/qwen3-asr-flash-2026-02-10',
			audio: { bytes: new Uint8Array([1]), format: 'webm' }
		});
		expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
			'https://openrouter.example/api/v1/audio/transcriptions'
		);
		const auth = (fetchMock.mock.calls[0]?.[1] as RequestInit)?.headers as Record<string, string>;
		expect(auth.Authorization).toBe('Bearer service-openrouter-key');
	});

	it('posts audio to OpenRouter /audio/transcriptions', async () => {
		const fetchMock = vi.fn(async () =>
			response(true, 200, { text: 'hello', usage: { cost: 0.001 } })
		);
		vi.stubGlobal('fetch', fetchMock);
		const out = await llmCreateTranscription({
			userId: 'u1',
			model: 'qwen/qwen3-asr-flash-2026-02-10',
			audio: { bytes: new Uint8Array([1, 2, 3]), format: 'webm', language: 'en' }
		});
		expect((out as { text: string }).text).toBe('hello');
		const url = fetchMock.mock.calls[0]?.[0];
		expect(String(url)).toBe('https://openrouter.example/api/v1/audio/transcriptions');
		const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string) as {
			model: string;
			input_audio: { data: string; format: string };
			language: string;
		};
		expect(body.model).toBe('qwen/qwen3-asr-flash-2026-02-10');
		expect(body.input_audio.format).toBe('webm');
		expect(body.language).toBe('en');
		expect(body.input_audio.data).toBe(Buffer.from([1, 2, 3]).toString('base64'));
	});

	it('logs OpenRouter STT cost from usage.cost in activity', async () => {
		const fetchMock = vi.fn(async () =>
			response(true, 200, { text: 'hello', usage: { cost: 0.0035 } })
		);
		vi.stubGlobal('fetch', fetchMock);
		await llmCreateTranscription({
			userId: 'u1',
			model: 'qwen/qwen3-asr-flash-2026-02-10',
			audio: { bytes: new Uint8Array([1, 2, 3]), format: 'webm' }
		});
		expect(logActivityCallMock).toHaveBeenCalledWith(
			expect.anything(),
			'u1',
			expect.objectContaining({
				provider: 'openrouter',
				operation: expect.stringContaining('llm.stt.success'),
				baseCostUsd: 0.0035,
				gatewayHost: 'openrouter.example'
			})
		);
	});

	it('STT retries on HTTP error then succeeds', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(response(false, 503, { error: 'busy' }))
			.mockResolvedValueOnce(response(true, 200, { text: 'retry ok', usage: { cost: 0.001 } }));
		vi.stubGlobal('fetch', fetchMock);
		const out = await llmCreateTranscription({
			userId: 'u1',
			model: 'qwen/qwen3-asr-flash-2026-02-10',
			audio: { bytes: new Uint8Array([1]), format: 'webm' }
		});
		expect((out as { text: string }).text).toBe('retry ok');
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(logActivityCallMock).toHaveBeenCalledWith(
			expect.anything(),
			'u1',
			expect.objectContaining({ operation: expect.stringContaining('llm.stt.error(attempt=1') })
		);
	});

	it('STT fails after three HTTP errors', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => response(false, 502, { error: 'bad gateway' })));
		await expect(
			llmCreateTranscription({
				userId: 'u1',
				model: 'qwen/qwen3-asr-flash-2026-02-10',
				audio: { bytes: new Uint8Array([1]), format: 'webm' }
			})
		).rejects.toThrow(/LLM STT HTTP 502/);
		expect(fetch).toHaveBeenCalledTimes(3);
	});

	it('STT handles non-json error body', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					({
						ok: false,
						status: 400,
						text: async () => 'invalid audio'
					}) as unknown as Response
			)
		);
		await expect(
			llmCreateTranscription({
				userId: 'u1',
				model: 'qwen/qwen3-asr-flash-2026-02-10',
				audio: { bytes: new Uint8Array([1]), format: 'webm' }
			})
		).rejects.toThrow(/LLM STT HTTP 400/);
	});

	it('STT throws fallback error when fetch rejects non-error value', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => Promise.reject('stt-boom')));
		await expect(
			llmCreateTranscription({
				userId: 'u1',
				model: 'qwen/qwen3-asr-flash-2026-02-10',
				audio: { bytes: new Uint8Array([1]), format: 'webm' }
			})
		).rejects.toThrow(/failed after 3 attempts/);
	});

	it('STT parses transcript from choices message content', async () => {
		const fetchMock = vi.fn(async () =>
			response(true, 200, {
				choices: [{ message: { content: 'from choices' } }],
				usage: { cost: 0.002 }
			})
		);
		vi.stubGlobal('fetch', fetchMock);
		await llmCreateTranscription({
			userId: 'u1',
			model: 'qwen/qwen3-asr-flash-2026-02-10',
			audio: { bytes: new Uint8Array([1]), format: 'webm' }
		});
		expect(logActivityCallMock).toHaveBeenCalledWith(
			expect.anything(),
			'u1',
			expect.objectContaining({ context: 'from choices' })
		);
	});

	it('STT uses transcript preview context when cost is present but text field is absent', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				response(true, 200, {
					choices: [{ message: { content: 'heard this' } }],
					usage: { cost: 0.002 }
				})
			)
		);
		await llmCreateTranscription({
			userId: 'u1',
			model: 'qwen/qwen3-asr-flash-2026-02-10',
			audio: { bytes: new Uint8Array([1]), format: 'webm' }
		});
		expect(logActivityCallMock).toHaveBeenCalledWith(
			expect.anything(),
			'u1',
			expect.objectContaining({ context: 'heard this', baseCostUsd: 0.002 })
		);
	});

	it('STT logs fallback context when transcript text is missing', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => response(true, 200, { usage: {} })));
		await llmCreateTranscription({
			userId: 'u1',
			model: 'qwen/qwen3-asr-flash-2026-02-10',
			audio: { bytes: new Uint8Array([1]), format: 'webm' }
		});
		expect(logActivityCallMock).toHaveBeenCalledWith(
			expect.anything(),
			'u1',
			expect.objectContaining({
				context: 'stt:qwen/qwen3-asr-flash-2026-02-10 (usage cost missing from gateway)'
			})
		);
	});

	it('BYOK STT fails when OPENROUTER_BASE_URL is missing', async () => {
		const { isByokBilling } = await import('$lib/server/billing/preferences');
		vi.mocked(isByokBilling).mockResolvedValue(true);
		mockEnv.OPENROUTER_BASE_URL = '';
		await expect(
			llmCreateTranscription({
				userId: 'u1',
				model: 'qwen/qwen3-asr-flash-2026-02-10',
				audio: { bytes: new Uint8Array([1]), format: 'webm' }
			})
		).rejects.toThrow(/OPENROUTER_BASE_URL/);
	});

	it('BYOK STT fails when OPENROUTER_API_KEY is missing', async () => {
		const { isByokBilling } = await import('$lib/server/billing/preferences');
		vi.mocked(isByokBilling).mockResolvedValue(true);
		mockEnv.OPENROUTER_API_KEY = '';
		await expect(
			llmCreateTranscription({
				userId: 'u1',
				model: 'qwen/qwen3-asr-flash-2026-02-10',
				audio: { bytes: new Uint8Array([1]), format: 'webm' }
			})
		).rejects.toThrow(/OPENROUTER_API_KEY/);
	});

	it('platform STT fails when SERVICE_API_KEY_OPENROUTER is missing', async () => {
		const { isByokBilling } = await import('$lib/server/billing/preferences');
		vi.mocked(isByokBilling).mockResolvedValue(false);
		mockEnv.SERVICE_API_KEY_OPENROUTER = '';
		await expect(
			llmCreateTranscription({
				userId: 'u1',
				model: 'qwen/qwen3-asr-flash-2026-02-10',
				audio: { bytes: new Uint8Array([1]), format: 'webm' }
			})
		).rejects.toThrow(/SERVICE_API_KEY_OPENROUTER/);
	});

	it('STT aborts when LLM_REQUEST_TIMEOUT_MS elapses', async () => {
		mockEnv.LLM_REQUEST_TIMEOUT_MS = '1';
		vi.stubGlobal('fetch', fetchThatWaitsForAbort());
		await expect(
			llmCreateTranscription({
				userId: 'u1',
				model: 'qwen/qwen3-asr-flash-2026-02-10',
				audio: { bytes: new Uint8Array([1]), format: 'webm' }
			})
		).rejects.toThrow(/LLM STT request timed out after 1ms/);
		expect(fetch).toHaveBeenCalledTimes(3);
	});
});

describe('llm client platform billing settlement', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEnv.LLM_BASE_URL = 'https://example.test';
		mockEnv.LLM_RULE_CHAT = 'rule-chat';
		mockEnv.LLM_RULE_EMBEDDING = 'rule-embed';
		mockEnv.LLM_MODEL_CHAT = 'gpt-test';
		mockEnv.LLM_MODEL_EMBEDDING = 'text-embedding-3-small';
		mockEnv.LLM_MIN_REQUEST_INTERVAL_MS = '0';
		mockEnv.LLM_REQUEST_TIMEOUT_MS = '';
		mockEnv.LLM_API_KEY = 'key-1';
		mockEnv.SERVICE_API_KEY_EUROUTER = 'service-eurouter-key';
	});

	it('settles provider-reported chat cost for platform billing', async () => {
		const { isByokBilling } = await import('$lib/server/billing/preferences');
		const { withPlatformBilling } = await import('$lib/server/billing/usage-gate');
		vi.mocked(isByokBilling).mockResolvedValue(false);
		vi.mocked(withPlatformBilling).mockImplementation(async (_userId, settle, fn) => {
			const result = await fn();
			expect(settle(result)).toBe(0.005);
			return result;
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				response(true, 200, { usage: { prompt_tokens: 1, cost: 0.005 }, choices: [] })
			)
		);
		await llmChatCompletion({ userId: 'u1', messages: [{ role: 'user', content: 'hi' }] });
	});

	it('settles provider-reported embedding cost for platform billing', async () => {
		const { isByokBilling } = await import('$lib/server/billing/preferences');
		const { withPlatformBilling } = await import('$lib/server/billing/usage-gate');
		vi.mocked(isByokBilling).mockResolvedValue(false);
		vi.mocked(withPlatformBilling).mockImplementation(async (_userId, settle, fn) => {
			const result = await fn();
			expect(settle(result)).toBe(0.002);
			return result;
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => response(true, 200, { usage: { total_tokens: 5, cost: 0.002 }, data: [] }))
		);
		await llmCreateEmbeddings({ userId: 'u1', input: 'hello' });
	});

	it('settles provider-reported STT cost for platform billing', async () => {
		const { isByokBilling } = await import('$lib/server/billing/preferences');
		const { withPlatformBilling } = await import('$lib/server/billing/usage-gate');
		vi.mocked(isByokBilling).mockResolvedValue(false);
		vi.mocked(withPlatformBilling).mockImplementation(async (_userId, settle, fn) => {
			const result = await fn();
			expect(settle(result)).toBe(0.0015);
			return result;
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => response(true, 200, { text: 'hello', usage: { cost: 0.0015 } }))
		);
		await llmCreateTranscription({
			userId: 'u1',
			model: 'qwen/qwen3-asr-flash-2026-02-10',
			audio: { bytes: new Uint8Array([1]), format: 'webm' }
		});
	});

	it('throws when platform billing cannot settle missing gateway cost', async () => {
		const { isByokBilling } = await import('$lib/server/billing/preferences');
		const { withPlatformBilling } = await import('$lib/server/billing/usage-gate');
		vi.mocked(isByokBilling).mockResolvedValue(false);
		vi.mocked(withPlatformBilling).mockImplementation(async (_userId, settle, fn) => {
			const result = await fn();
			expect(() => settle(result)).toThrow(/usage\.cost/);
			return result;
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => response(true, 200, { usage: { total_tokens: 1 }, choices: [] }))
		);
		await llmChatCompletion({ userId: 'u1', messages: [{ role: 'user', content: 'hi' }] });
	});
});

describe('llm client platform billing', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEnv.LLM_BASE_URL = 'https://example.test';
		mockEnv.LLM_RULE_CHAT = 'rule-chat';
		mockEnv.LLM_RULE_EMBEDDING = 'rule-embed';
		mockEnv.LLM_MODEL_CHAT = 'gpt-test';
		mockEnv.LLM_MODEL_EMBEDDING = 'text-embedding-3-small';
		mockEnv.LLM_MIN_REQUEST_INTERVAL_MS = '0';
		mockEnv.LLM_REQUEST_TIMEOUT_MS = '';
		mockEnv.LLM_API_KEY = 'key-1';
		mockEnv.SERVICE_API_KEY_EUROUTER = 'service-eurouter-key';
		mockEnv.SERVICE_API_KEY_OPENROUTER = 'service-openrouter-key';
		mockEnv.OPENROUTER_BASE_URL = 'https://openrouter.example/api/v1';
	});

	it('uses platform EUrouter credentials when billing is not BYOK', async () => {
		const { isByokBilling } = await import('$lib/server/billing/preferences');
		vi.mocked(isByokBilling).mockResolvedValue(false);
		const fetchMock = vi.fn(async () =>
			response(true, 200, { usage: { prompt_tokens: 1 }, choices: [] })
		);
		vi.stubGlobal('fetch', fetchMock);
		await llmChatCompletion({ userId: 'u1', messages: [{ role: 'user', content: 'hi' }] });
		const auth = (fetchMock.mock.calls[0]?.[1] as RequestInit)?.headers as Record<string, string>;
		expect(auth.Authorization).toBe('Bearer service-eurouter-key');
	});

	it('platform OpenRouter chat uses SERVICE_API_KEY_OPENROUTER', async () => {
		const { isByokBilling } = await import('$lib/server/billing/preferences');
		vi.mocked(isByokBilling).mockResolvedValue(false);
		mockSequentialDbLimitResults([{ provider: 'openrouter' }]);
		const fetchMock = vi.fn(async () =>
			response(true, 200, { usage: { prompt_tokens: 1 }, choices: [] })
		);
		vi.stubGlobal('fetch', fetchMock);
		await llmChatCompletion({ userId: 'u1', messages: [{ role: 'user', content: 'hi' }] });
		const auth = (fetchMock.mock.calls[0]?.[1] as RequestInit)?.headers as Record<string, string>;
		expect(auth.Authorization).toBe('Bearer service-openrouter-key');
	});

	it('platform EUrouter fails when SERVICE_API_KEY_EUROUTER is missing', async () => {
		const { isByokBilling } = await import('$lib/server/billing/preferences');
		vi.mocked(isByokBilling).mockResolvedValue(false);
		mockEnv.SERVICE_API_KEY_EUROUTER = '';
		await expect(
			llmChatCompletion({ userId: 'u1', messages: [{ role: 'user', content: 'hi' }] })
		).rejects.toThrow(/SERVICE_API_KEY_EUROUTER/);
	});
});

describe('llm client BYOK DB credentials', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		mockEnv.LLM_MIN_REQUEST_INTERVAL_MS = '0';
		mockEnv.LLM_REQUEST_TIMEOUT_MS = '';
		mockEnv.LLM_MODEL_CHAT = 'gpt-test';
		const { isByokBilling } = await import('$lib/server/billing/preferences');
		vi.mocked(isByokBilling).mockResolvedValue(true);
	});

	it('loads encrypted api key from DB via decryptTenantValue', async () => {
		const { isByokBilling } = await import('$lib/server/billing/preferences');
		vi.mocked(isByokBilling).mockResolvedValue(true);
		mockSequentialDbLimitResults(
			[{ provider: 'eurouter' }],
			[
				{
					provider: 'eurouter',
					baseUrl: 'https://db-gateway.example/v1',
					apiKey: 'placeholder',
					apiKeyEncrypted: 'enc-blob',
					ruleChat: 'db-rule-chat',
					ruleEmbedding: 'db-rule-embed',
					modelChat: 'db-chat-model',
					modelEmbedding: 'db-embed-model'
				}
			]
		);
		const fetchMock = vi.fn(async () =>
			response(true, 200, { usage: { prompt_tokens: 1 }, choices: [] })
		);
		vi.stubGlobal('fetch', fetchMock);
		await llmChatCompletion({ userId: 'u1', messages: [{ role: 'user', content: 'hi' }] });
		expect(decryptTenantValueMock).toHaveBeenCalledWith(
			expect.objectContaining({ userId: 'u1', ciphertext: 'enc-blob' })
		);
		const auth = (fetchMock.mock.calls[0]?.[1] as RequestInit)?.headers as Record<string, string>;
		expect(auth.Authorization).toBe('Bearer decrypted-key');
		expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://db-gateway.example/v1/chat/completions');
	});

	it('falls back to env credentials when DB row is incomplete', async () => {
		const { isByokBilling } = await import('$lib/server/billing/preferences');
		vi.mocked(isByokBilling).mockResolvedValue(true);
		mockEnv.LLM_BASE_URL = 'https://env-gateway.example/v1';
		mockEnv.LLM_API_KEY = 'env-key';
		mockSequentialDbLimitResults(
			[{ provider: 'eurouter' }],
			[
				{
					provider: 'eurouter',
					baseUrl: null,
					apiKey: 'db-key',
					apiKeyEncrypted: null,
					ruleChat: 'rule-chat',
					ruleEmbedding: 'rule-embed',
					modelChat: null,
					modelEmbedding: null
				}
			]
		);
		const fetchMock = vi.fn(async () =>
			response(true, 200, { usage: { prompt_tokens: 1 }, choices: [] })
		);
		vi.stubGlobal('fetch', fetchMock);
		await llmChatCompletion({ userId: 'u1', messages: [{ role: 'user', content: 'hi' }] });
		expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
			'https://env-gateway.example/v1/chat/completions'
		);
	});

	it('rejects Docker placeholder base URL from DB eurouter credentials', async () => {
		const { isByokBilling } = await import('$lib/server/billing/preferences');
		vi.mocked(isByokBilling).mockResolvedValue(true);
		mockSequentialDbLimitResults(
			[{ provider: 'eurouter' }],
			[
				{
					provider: 'eurouter',
					baseUrl: 'https://example.com/v1',
					apiKey: 'db-key',
					apiKeyEncrypted: null,
					ruleChat: 'rule-chat',
					ruleEmbedding: 'rule-embed',
					modelChat: null,
					modelEmbedding: null
				}
			]
		);
		await expect(
			llmChatCompletion({ userId: 'u1', messages: [{ role: 'user', content: 'hi' }] })
		).rejects.toThrow(/Docker placeholder/);
	});
});

describe('llm client OpenRouter routing', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		mockEnv.LLM_MIN_REQUEST_INTERVAL_MS = '0';
		mockEnv.LLM_REQUEST_TIMEOUT_MS = '';
		mockEnv.LLM_MODEL_CHAT = '';
		mockEnv.LLM_MODEL_EMBEDDING = '';
		const { isByokBilling } = await import('$lib/server/billing/preferences');
		vi.mocked(isByokBilling).mockResolvedValue(true);
	});

	it('BYOK OpenRouter chat uses modelChat from DB', async () => {
		const { isByokBilling } = await import('$lib/server/billing/preferences');
		vi.mocked(isByokBilling).mockResolvedValue(true);
		mockSequentialDbLimitResults(
			[{ provider: 'openrouter' }],
			[
				{
					provider: 'openrouter',
					baseUrl: 'https://db-openrouter.example/api/v1',
					apiKey: 'db-key',
					apiKeyEncrypted: null,
					ruleChat: null,
					ruleEmbedding: null,
					modelChat: 'openrouter/chat-model',
					modelEmbedding: null
				}
			]
		);
		const fetchMock = vi.fn(async () =>
			response(true, 200, { usage: { prompt_tokens: 1 }, choices: [] })
		);
		vi.stubGlobal('fetch', fetchMock);
		await llmChatCompletion({ userId: 'u1', messages: [{ role: 'user', content: 'hi' }] });
		const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string) as {
			model: string;
			rule_id?: string;
		};
		expect(body.model).toBe('openrouter/chat-model');
		expect(body.rule_id).toBeUndefined();
	});

	it('BYOK OpenRouter embedding uses modelEmbedding from DB', async () => {
		const { isByokBilling } = await import('$lib/server/billing/preferences');
		vi.mocked(isByokBilling).mockResolvedValue(true);
		mockSequentialDbLimitResults(
			[{ provider: 'openrouter' }],
			[
				{
					provider: 'openrouter',
					baseUrl: 'https://db-openrouter.example/api/v1',
					apiKey: 'db-key',
					apiKeyEncrypted: null,
					ruleChat: null,
					ruleEmbedding: null,
					modelChat: null,
					modelEmbedding: 'openrouter/embed-model'
				}
			]
		);
		const fetchMock = vi.fn(async () =>
			response(true, 200, { usage: { total_tokens: 1 }, data: [] })
		);
		vi.stubGlobal('fetch', fetchMock);
		await llmCreateEmbeddings({ userId: 'u1', input: 'hello' });
		const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string) as {
			model: string;
		};
		expect(body.model).toBe('openrouter/embed-model');
	});

	it('fails when OpenRouter chat model is not configured', async () => {
		const { isByokBilling } = await import('$lib/server/billing/preferences');
		vi.mocked(isByokBilling).mockResolvedValue(true);
		mockSequentialDbLimitResults(
			[{ provider: 'openrouter' }],
			[
				{
					provider: 'openrouter',
					baseUrl: 'https://db-openrouter.example/api/v1',
					apiKey: 'db-key',
					apiKeyEncrypted: null,
					ruleChat: null,
					ruleEmbedding: null,
					modelChat: null,
					modelEmbedding: null
				}
			]
		);
		await expect(
			llmChatCompletion({ userId: 'u1', messages: [{ role: 'user', content: 'hi' }] })
		).rejects.toThrow(/OpenRouter chat model not configured/);
	});

	it('fails when OpenRouter embedding model is not configured', async () => {
		const { isByokBilling } = await import('$lib/server/billing/preferences');
		vi.mocked(isByokBilling).mockResolvedValue(true);
		mockSequentialDbLimitResults(
			[{ provider: 'openrouter' }],
			[
				{
					provider: 'openrouter',
					baseUrl: 'https://db-openrouter.example/api/v1',
					apiKey: 'db-key',
					apiKeyEncrypted: null,
					ruleChat: null,
					ruleEmbedding: null,
					modelChat: null,
					modelEmbedding: null
				}
			]
		);
		await expect(llmCreateEmbeddings({ userId: 'u1', input: 'hello' })).rejects.toThrow(
			/OpenRouter embedding model not configured/
		);
	});
});

describe('llm client response parsing and options', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEnv.LLM_BASE_URL = 'https://example.test';
		mockEnv.LLM_RULE_CHAT = 'rule-chat';
		mockEnv.LLM_RULE_EMBEDDING = 'rule-embed';
		mockEnv.LLM_MODEL_CHAT = 'gpt-test';
		mockEnv.LLM_MODEL_EMBEDDING = 'text-embedding-3-small';
		mockEnv.LLM_MIN_REQUEST_INTERVAL_MS = '0';
		mockEnv.LLM_REQUEST_TIMEOUT_MS = '';
		mockEnv.LLM_API_KEY = 'key-1';
	});

	it('chat includes maxTokens when provided', async () => {
		const fetchMock = vi.fn(async () =>
			response(true, 200, { usage: { prompt_tokens: 1 }, choices: [] })
		);
		vi.stubGlobal('fetch', fetchMock);
		await llmChatCompletion({
			userId: 'u1',
			messages: [{ role: 'user', content: 'hello' }],
			maxTokens: 256
		});
		const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string) as {
			max_tokens?: number;
		};
		expect(body.max_tokens).toBe(256);
	});

	it('chat logs empty response text for non-text message content', async () => {
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				response(true, 200, {
					usage: { prompt_tokens: 1 },
					choices: [{ message: { content: { notText: true } } }]
				})
			)
		);
		await llmChatCompletion({
			userId: 'u1',
			messages: [{ role: 'user', content: 'hello' }],
			logContext: 'non-text'
		});
		expect(logSpy).toHaveBeenCalledWith('[llm.chat:non-text] response attempt 1:\n');
		logSpy.mockRestore();
	});

	it('chat logs array content parts from gateway response', async () => {
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				response(true, 200, {
					usage: { prompt_tokens: 1 },
					choices: [
						{
							message: {
								content: [
									{ text: 'part-one' },
									'part-two',
									{ text: 42 },
									null
								]
							}
						}
					]
				})
			)
		);
		await llmChatCompletion({
			userId: 'u1',
			messages: [{ role: 'user', content: 'hello' }],
			logContext: 'parse test'
		});
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining('[llm.chat:parse_test] response attempt 1:\npart-onepart-two')
		);
		logSpy.mockRestore();
	});

	it('chat succeeds on second attempt after first failure', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(response(false, 429, { error: 'rate limited' }))
			.mockResolvedValueOnce(
				response(true, 200, { usage: { prompt_tokens: 1 }, choices: [{ message: { content: 'ok' } }] })
			);
		vi.stubGlobal('fetch', fetchMock);
		await llmChatCompletion({ userId: 'u1', messages: [{ role: 'user', content: 'hello' }] });
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(logActivityCallMock).toHaveBeenCalledWith(
			expect.anything(),
			'u1',
			expect.objectContaining({ operation: 'llm.chat.chat.error(attempt=1)' })
		);
	});

	it('chat uses empty context when no user message is present', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => response(true, 200, { usage: { prompt_tokens: 1 }, choices: [] }))
		);
		await llmChatCompletion({
			userId: 'u1',
			messages: [{ role: 'system', content: 'system only' }]
		});
		expect(logActivityCallMock).toHaveBeenCalledWith(
			expect.anything(),
			'u1',
			expect.objectContaining({ context: '' })
		);
	});

	it('embedding logs and previews array input', async () => {
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => response(true, 200, { usage: { total_tokens: 2 }, data: [] }))
		);
		await llmCreateEmbeddings({
			userId: 'u1',
			input: ['short', 'x'.repeat(200)]
		});
		expect(logSpy).toHaveBeenCalledWith('[llm.embedding] input[0]: short');
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringMatching(/\[llm\.embedding\] input\[1\]: x+\.\.\./)
		);
		expect(logActivityCallMock).toHaveBeenCalledWith(
			expect.anything(),
			'u1',
			expect.objectContaining({ context: 'short' })
		);
		logSpy.mockRestore();
	});

	it('chat routing rule lookup is cached on second call', async () => {
		vi.resetModules();
		mockEnv.LLM_MODEL_CHAT = '';
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(response(true, 200, { data: { model: 'cached-rule-model' } }))
			.mockResolvedValueOnce(response(true, 200, { usage: { prompt_tokens: 1 }, choices: [] }))
			.mockResolvedValueOnce(response(true, 200, { usage: { prompt_tokens: 1 }, choices: [] }));
		vi.stubGlobal('fetch', fetchMock);
		const { llmChatCompletion: chat } = await import('./llm-client');
		await chat({ userId: 'u1', messages: [{ role: 'user', content: 'one' }] });
		await chat({ userId: 'u1', messages: [{ role: 'user', content: 'two' }] });
		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/routing-rules/rule-chat');
	});

	it('chat logs error context as empty when no user message exists', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(response(false, 500, { error: 'down' }))
			.mockResolvedValueOnce(response(false, 500, { error: 'down' }))
			.mockResolvedValueOnce(response(false, 500, { error: 'down' }));
		vi.stubGlobal('fetch', fetchMock);
		await expect(
			llmChatCompletion({
				userId: 'u1',
				messages: [{ role: 'assistant', content: 'prior answer' }]
			})
		).rejects.toThrow(/LLM HTTP 500/);
		expect(logActivityCallMock).toHaveBeenCalledWith(
			expect.anything(),
			'u1',
			expect.objectContaining({ operation: 'llm.chat.chat.error(attempt=1)', context: '' })
		);
	});

	it('embedding logs array input preview on error attempts', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => response(false, 500, { error: 'down' })));
		await expect(llmCreateEmbeddings({ userId: 'u1', input: ['alpha', 'beta'] })).rejects.toThrow(
			/LLM HTTP 500/
		);
		expect(logActivityCallMock).toHaveBeenCalledWith(
			expect.anything(),
			'u1',
			expect.objectContaining({ operation: 'llm.embedding.error(attempt=1)', context: 'alpha' })
		);
	});

	it('chat includes provider from routing rule lookup', async () => {
		vi.resetModules();
		mockEnv.LLM_MODEL_CHAT = '';
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				response(true, 200, {
					model: 'direct-model',
					provider: { data_residency: 'EU' }
				})
			)
			.mockResolvedValueOnce(response(true, 200, { usage: { prompt_tokens: 1 }, choices: [] }));
		vi.stubGlobal('fetch', fetchMock);
		const { llmChatCompletion: chat } = await import('./llm-client');
		await chat({ userId: 'u1', messages: [{ role: 'user', content: 'hi' }] });
		const body = JSON.parse((fetchMock.mock.calls[1]?.[1] as RequestInit).body as string) as {
			model: string;
			provider?: Record<string, unknown>;
		};
		expect(body.model).toBe('direct-model');
		expect(body.provider).toEqual({ data_residency: 'EU' });
	});
});

describe('llm client timeout and rate limit defaults', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEnv.LLM_BASE_URL = 'https://example.test';
		mockEnv.LLM_RULE_CHAT = 'rule-chat';
		mockEnv.LLM_MODEL_CHAT = 'gpt-test';
		mockEnv.LLM_API_KEY = 'key-1';
	});

	it('aborts chat request when LLM_REQUEST_TIMEOUT_MS elapses', async () => {
		mockEnv.LLM_REQUEST_TIMEOUT_MS = '1';
		mockEnv.LLM_MIN_REQUEST_INTERVAL_MS = '0';
		vi.stubGlobal('fetch', fetchThatWaitsForAbort());
		await expect(
			llmChatCompletion({
				userId: 'u1',
				messages: [{ role: 'user', content: 'hello' }]
			})
		).rejects.toThrow(/LLM request timed out after 1ms/);
		expect(fetch).toHaveBeenCalledTimes(3);
	});

	it('aborts embedding request when LLM_REQUEST_TIMEOUT_MS elapses', async () => {
		mockEnv.LLM_REQUEST_TIMEOUT_MS = '1';
		mockEnv.LLM_MIN_REQUEST_INTERVAL_MS = '0';
		mockEnv.LLM_MODEL_EMBEDDING = 'text-embedding-3-small';
		mockEnv.LLM_RULE_EMBEDDING = 'rule-embed';
		vi.stubGlobal('fetch', fetchThatWaitsForAbort());
		await expect(llmCreateEmbeddings({ userId: 'u1', input: 'hello' })).rejects.toThrow(
			/LLM embedding request timed out after 1ms/
		);
		expect(fetch).toHaveBeenCalledTimes(3);
	});

	it('logs embedding request for a single string input', async () => {
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => response(true, 200, { usage: { total_tokens: 2 }, data: [] }))
		);
		await llmCreateEmbeddings({ userId: 'u1', input: 'x'.repeat(120) });
		expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/\[llm\.embedding\] input: x+\.\.\./));
		logSpy.mockRestore();
	});

	it('logs STT response when body is empty', async () => {
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.stubGlobal('fetch', vi.fn(async () => response(true, 200, null)));
		await llmCreateTranscription({
			userId: 'u1',
			model: 'qwen/qwen3-asr-flash-2026-02-10',
			audio: { bytes: new Uint8Array([1]), format: 'webm' }
		});
		expect(logSpy).toHaveBeenCalledWith('[llm.stt] response attempt 1: (empty response)');
		logSpy.mockRestore();
	});

	it('uses default 1000ms rate limit when env var is empty', async () => {
		vi.resetModules();
		vi.useFakeTimers();
		try {
			mockEnv.LLM_MIN_REQUEST_INTERVAL_MS = '';
			mockEnv.LLM_REQUEST_TIMEOUT_MS = '';
			vi.stubGlobal(
				'fetch',
				vi.fn(async () =>
					response(true, 200, { usage: { prompt_tokens: 1 }, choices: [] })
				)
			);
			const { llmChatCompletion: chat } = await import('./llm-client');
			const first = chat({ userId: 'u-rate', messages: [{ role: 'user', content: 'a' }] });
			await vi.advanceTimersByTimeAsync(0);
			const second = chat({ userId: 'u-rate', messages: [{ role: 'user', content: 'b' }] });
			await vi.advanceTimersByTimeAsync(1000);
			await first;
			await second;
			expect(fetch).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});
});
