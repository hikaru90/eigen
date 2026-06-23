import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEnv } = vi.hoisted(() => ({
	mockEnv: {} as Record<string, string | undefined>
}));

vi.mock('$env/dynamic/private', () => ({
	env: mockEnv
}));

describe('isByokUiEnabled', () => {
	beforeEach(() => {
		for (const key of Object.keys(mockEnv)) {
			delete mockEnv[key];
		}
	});

	it('returns false when env is unset', async () => {
		const { isByokUiEnabled } = await import('./byok-ui');
		expect(isByokUiEnabled()).toBe(false);
	});

	it('returns false for non-true values', async () => {
		mockEnv.BILLING_BYOK_UI_ENABLED = 'false';
		const { isByokUiEnabled } = await import('./byok-ui');
		expect(isByokUiEnabled()).toBe(false);
	});

	it('returns true when BILLING_BYOK_UI_ENABLED=true', async () => {
		mockEnv.BILLING_BYOK_UI_ENABLED = 'true';
		const { isByokUiEnabled } = await import('./byok-ui');
		expect(isByokUiEnabled()).toBe(true);
	});
});
