import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeTokenCostUsd, llmChatCompletion, llmCreateEmbeddings } from './llm-client';

const { mockEnv, logActivityCallMock, getDbMock } = vi.hoisted(() => ({
	mockEnv: {
		LLM_BASE_URL: 'https://example.test',
		LLM_RULE_CHAT: 'rule-chat',
		LLM_RULE_EMBEDDING: 'rule-embed',
		LLM_API_KEY: 'key-1'
	},
	logActivityCallMock: vi.fn(),
	getDbMock: vi.fn(() => ({}))
}));

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

	it('falls back to total tokens', () => {
		expect(computeTokenCostUsd({ total_tokens: 1000 })).toBeCloseTo(0.000065);
	});

	it('throws when usage is missing', () => {
		expect(() => computeTokenCostUsd(undefined)).toThrow(/missing usage/);
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
		mockEnv.LLM_API_KEY = 'key-1';
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
			expect.objectContaining({ operation: 'llm.chat.success(attempt=1)' })
		);
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
			expect.objectContaining({ operation: 'llm.embedding.error(attempt=1)' })
		);
		expect(logActivityCallMock).toHaveBeenCalledWith(
			expect.anything(),
			'u1',
			expect.objectContaining({ operation: 'llm.embedding.success(attempt=2)' })
		);
	});

	it('fails when required env is missing', async () => {
		mockEnv.LLM_API_KEY = '';
		await expect(
			llmCreateEmbeddings({ userId: 'u1', input: 'hello' })
		).rejects.toThrow(/LLM_API_KEY is not set/);
	});
});
