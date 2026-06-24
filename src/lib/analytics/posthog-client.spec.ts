import { describe, expect, it, vi, beforeEach } from 'vitest';

const { initMock, captureMock, identifyMock, resetMock, captureExceptionMock, publicEnv } = vi.hoisted(
	() => ({
		initMock: vi.fn(),
		captureMock: vi.fn(),
		identifyMock: vi.fn(),
		resetMock: vi.fn(),
		captureExceptionMock: vi.fn(),
		publicEnv: {
			PUBLIC_POSTHOG_KEY: '',
			PUBLIC_POSTHOG_HOST: ''
		}
	})
);

vi.mock('$env/static/public', () => publicEnv);

vi.mock('posthog-js', () => ({
	default: {
		init: initMock,
		capture: captureMock,
		identify: identifyMock,
		reset: resetMock,
		captureException: captureExceptionMock
	}
}));

vi.mock('$app/environment', () => ({
	browser: true
}));

describe('posthog-client', () => {
	beforeEach(() => {
		vi.resetModules();
		publicEnv.PUBLIC_POSTHOG_KEY = '';
		publicEnv.PUBLIC_POSTHOG_HOST = '';
		initMock.mockClear();
		captureMock.mockClear();
		identifyMock.mockClear();
		resetMock.mockClear();
		captureExceptionMock.mockClear();
	});

	it('isPostHogEnabled is false when PUBLIC_POSTHOG_KEY is unset', async () => {
		const { isPostHogEnabled } = await import('./posthog-client');
		expect(isPostHogEnabled()).toBe(false);
	});

	it('initPostHog initializes with EU host default when key is set', async () => {
		publicEnv.PUBLIC_POSTHOG_KEY = 'phc_test_key';
		const { initPostHog, capture } = await import('./posthog-client');
		initPostHog();
		expect(initMock).toHaveBeenCalledWith('phc_test_key', {
			api_host: '/ingest',
			ui_host: 'https://eu.posthog.com',
			defaults: '2026-01-30',
			person_profiles: 'identified_only',
			capture_pageview: false,
			capture_exceptions: true
		});
		capture('test_event', { foo: 'bar' });
		expect(captureMock).toHaveBeenCalledWith('test_event', { foo: 'bar' });
	});

	it('capture lazy-inits when initPostHog was not called first', async () => {
		publicEnv.PUBLIC_POSTHOG_KEY = 'phc_test_key';
		const { capture } = await import('./posthog-client');
		capture('lazy_event');
		expect(initMock).toHaveBeenCalled();
		expect(captureMock).toHaveBeenCalledWith('lazy_event', undefined);
	});

	it('capture is a no-op when PUBLIC_POSTHOG_KEY is unset', async () => {
		const { capture } = await import('./posthog-client');
		capture('ignored_event');
		expect(initMock).not.toHaveBeenCalled();
		expect(captureMock).not.toHaveBeenCalled();
	});
});
