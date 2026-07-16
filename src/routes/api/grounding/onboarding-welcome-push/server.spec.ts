import { describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

const { scheduleOnboardingGroundingPushMock } = vi.hoisted(() => ({
	scheduleOnboardingGroundingPushMock: vi.fn()
}));

vi.mock('$lib/server/grounding/onboarding-welcome-push', () => ({
	scheduleOnboardingGroundingPush: scheduleOnboardingGroundingPushMock
}));

function event(overrides: { user?: { id: string } | null; body?: unknown } = {}) {
	return {
		locals: { user: overrides.user === undefined ? { id: 'u1' } : overrides.user },
		request: new Request('http://localhost/api/grounding/onboarding-welcome-push', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(overrides.body ?? {})
		})
	} as Parameters<typeof POST>[0];
}

describe('POST /api/grounding/onboarding-welcome-push', () => {
	it('returns 401 when unauthenticated', async () => {
		await expect(POST(event({ user: null }))).rejects.toMatchObject({ status: 401 });
	});

	it('schedules the push with the default delay when body is empty', async () => {
		scheduleOnboardingGroundingPushMock.mockResolvedValue({ scheduled: true });
		const res = await POST(event({ body: {} }));
		expect(scheduleOnboardingGroundingPushMock).toHaveBeenCalledWith(
			expect.objectContaining({ userId: 'u1' })
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ ok: true, scheduled: true });
	});

	it('uses a custom delayMs when provided', async () => {
		scheduleOnboardingGroundingPushMock.mockResolvedValue({ scheduled: true });
		await POST(event({ body: { delayMs: 5000 } }));
		expect(scheduleOnboardingGroundingPushMock).toHaveBeenCalledWith({
			userId: 'u1',
			delayMs: 5000
		});
	});

	it('returns 503 when VAPID keys are misconfigured', async () => {
		scheduleOnboardingGroundingPushMock.mockRejectedValue(new Error('VAPID_PRIVATE_KEY missing'));
		await expect(POST(event({ body: {} }))).rejects.toMatchObject({ status: 503 });
	});

	it('returns 500 for other errors', async () => {
		scheduleOnboardingGroundingPushMock.mockRejectedValue(new Error('boom'));
		await expect(POST(event({ body: {} }))).rejects.toMatchObject({ status: 500 });
	});
});
