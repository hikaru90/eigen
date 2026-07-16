import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	getOnboardingFirstGroundingQuestion,
	processOnboardingGroundingPushJob,
	scheduleOnboardingGroundingPush
} from '$lib/server/grounding/onboarding-welcome-push';

const {
	listPushSubscriptionsForUserMock,
	sendPushToUserMock,
	enqueueUserJobMock,
	createAdminSqlMock,
	sqlEndMock,
	sqlQueryMock
} = vi.hoisted(() => ({
	listPushSubscriptionsForUserMock: vi.fn(),
	sendPushToUserMock: vi.fn(),
	enqueueUserJobMock: vi.fn(),
	createAdminSqlMock: vi.fn(),
	sqlEndMock: vi.fn(),
	sqlQueryMock: vi.fn()
}));

vi.mock('$lib/server/push/subscription', () => ({
	listPushSubscriptionsForUser: listPushSubscriptionsForUserMock
}));

vi.mock('$lib/server/push/send', () => ({
	sendPushToUser: sendPushToUserMock
}));

vi.mock('$lib/server/job-queue/enqueue', () => ({
	enqueueUserJob: enqueueUserJobMock
}));

vi.mock('$lib/server/job-queue/admin-db', () => ({
	createAdminSql: createAdminSqlMock
}));

describe('onboarding welcome push', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		listPushSubscriptionsForUserMock.mockResolvedValue([{ id: 'sub1' }]);
		sendPushToUserMock.mockResolvedValue({ sent: 1, failed: 0, removed: 0, errors: [] });
		enqueueUserJobMock.mockResolvedValue({ enqueued: true, jobId: 'job-1' });
		sqlQueryMock.mockResolvedValue([]);
		sqlEndMock.mockResolvedValue(undefined);
		createAdminSqlMock.mockReturnValue(Object.assign(sqlQueryMock, { end: sqlEndMock }));
	});

	it('builds the fixed first grounding question', () => {
		expect(getOnboardingFirstGroundingQuestion()).toEqual({
			facetKey: 'work',
			question: 'Where do you work?'
		});
	});

	it('sends the welcome push with check-in deep link', async () => {
		await processOnboardingGroundingPushJob('u1');
		expect(sendPushToUserMock).toHaveBeenCalledWith('u1', {
			title: 'One quick question',
			body: 'Where do you work?',
			url: '/capture?checkin=1&welcome=1',
			tag: 'onboarding-grounding'
		});
	});

	it('refuses to schedule without a push subscription', async () => {
		listPushSubscriptionsForUserMock.mockResolvedValue([]);
		const result = await scheduleOnboardingGroundingPush({ userId: 'u1', delayMs: 30_000 });
		expect(result).toEqual({ scheduled: false, reason: 'no_push_subscription' });
		expect(enqueueUserJobMock).not.toHaveBeenCalled();
	});

	it('enqueues a delayed job when subscribed', async () => {
		const result = await scheduleOnboardingGroundingPush({ userId: 'u1', delayMs: 30_000 });
		expect(result).toEqual({ scheduled: true, jobId: 'job-1', delayMs: 30_000 });
		expect(enqueueUserJobMock).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 'u1',
				jobType: 'onboarding_grounding_push',
				dedupeKey: 'onboarding_grounding_push',
				maxAttempts: 3
			})
		);
	});

	it('skips enqueue when a prior onboarding push job exists', async () => {
		sqlQueryMock.mockResolvedValue([{ id: 'existing' }]);
		const result = await scheduleOnboardingGroundingPush({ userId: 'u1', delayMs: 30_000 });
		expect(result).toEqual({ scheduled: false, reason: 'duplicate' });
		expect(enqueueUserJobMock).not.toHaveBeenCalled();
	});
});
