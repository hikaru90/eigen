import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPlatformLlmConfig, loadPlatformOpenRouterSttConfig } from './platform-llm';

const { mockEnv, limitMock } = vi.hoisted(() => ({
	mockEnv: {} as Record<string, string | undefined>,
	limitMock: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({
	env: mockEnv
}));

vi.mock('$lib/server/db', () => ({
	withDbUser: async (_userId: string, fn: (db: unknown) => Promise<unknown>) =>
		fn({
			select: () => ({
				from: () => ({
					where: () => ({
						limit: limitMock
					})
				})
			})
		})
}));

describe('loadPlatformLlmConfig', () => {
	beforeEach(() => {
		limitMock.mockReset();
		for (const key of Object.keys(mockEnv)) {
			delete mockEnv[key];
		}
	});

	it('loads EUrouter config from service key', async () => {
		limitMock.mockResolvedValue([]);
		mockEnv.LLM_BASE_URL = 'https://eurouter.example/v1';
		mockEnv.SERVICE_API_KEY_EUROUTER = 'eurouter-service-key';
		mockEnv.LLM_RULE_CHAT = 'rule-chat';
		mockEnv.LLM_RULE_EMBEDDING = 'rule-embed';

		const config = await loadPlatformLlmConfig('user-1');

		expect(config).toEqual({
			provider: 'eurouter',
			baseUrl: 'https://eurouter.example/v1',
			apiKey: 'eurouter-service-key',
			ruleChat: 'rule-chat',
			ruleEmbedding: 'rule-embed',
			modelChat: null,
			modelEmbedding: null
		});
	});

	it('loads OpenRouter config when active provider is openrouter', async () => {
		limitMock.mockResolvedValue([{ provider: 'openrouter' }]);
		mockEnv.OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
		mockEnv.SERVICE_API_KEY_OPENROUTER = 'openrouter-service-key';
		mockEnv.LLM_MODEL_CHAT = 'gpt-test';

		const config = await loadPlatformLlmConfig('user-1');

		expect(config.provider).toBe('openrouter');
		expect(config.apiKey).toBe('openrouter-service-key');
		expect(config.modelChat).toBe('gpt-test');
	});

	it('throws when LLM_BASE_URL is the Docker placeholder', async () => {
		limitMock.mockResolvedValue([]);
		mockEnv.LLM_BASE_URL = 'https://example.com/v1';
		mockEnv.SERVICE_API_KEY_EUROUTER = 'eurouter-service-key';
		mockEnv.LLM_RULE_CHAT = 'real-rule-chat';
		mockEnv.LLM_RULE_EMBEDDING = 'real-rule-embed';

		await expect(loadPlatformLlmConfig('user-1')).rejects.toThrow(/Docker placeholder/);
	});

	it('throws when SERVICE_API_KEY_EUROUTER is missing', async () => {
		limitMock.mockResolvedValue([]);
		mockEnv.LLM_BASE_URL = 'https://eurouter.example/v1';

		await expect(loadPlatformLlmConfig('user-1')).rejects.toThrow(/SERVICE_API_KEY_EUROUTER/);
	});

	it('throws when SERVICE_API_KEY_OPENROUTER is missing', async () => {
		limitMock.mockResolvedValue([{ provider: 'openrouter' }]);
		mockEnv.OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

		await expect(loadPlatformLlmConfig('user-1')).rejects.toThrow(/SERVICE_API_KEY_OPENROUTER/);
	});
});

describe('loadPlatformOpenRouterSttConfig', () => {
	beforeEach(() => {
		for (const key of Object.keys(mockEnv)) {
			delete mockEnv[key];
		}
	});

	it('loads STT config from service OpenRouter key', async () => {
		mockEnv.OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
		mockEnv.SERVICE_API_KEY_OPENROUTER = 'openrouter-service-key';

		const config = await loadPlatformOpenRouterSttConfig();

		expect(config.provider).toBe('openrouter');
		expect(config.apiKey).toBe('openrouter-service-key');
	});

	it('throws when SERVICE_API_KEY_OPENROUTER is missing', async () => {
		mockEnv.OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

		await expect(loadPlatformOpenRouterSttConfig()).rejects.toThrow(/SERVICE_API_KEY_OPENROUTER/);
	});
});
