import { beforeEach, describe, expect, it, vi } from 'vitest';
import { maybeNotifyGroundingQuestionPush } from '$lib/server/grounding/notify-question';

const {
	isCheckInQuestionDueMock,
	listPushSubscriptionsForUserMock,
	generateCheckInQuestionMock,
	sendPushToUserMock
} = vi.hoisted(() => ({
	isCheckInQuestionDueMock: vi.fn(),
	listPushSubscriptionsForUserMock: vi.fn(),
	generateCheckInQuestionMock: vi.fn(),
	sendPushToUserMock: vi.fn()
}));

vi.mock('$lib/server/grounding/question-due', () => ({
	isCheckInQuestionDue: isCheckInQuestionDueMock
}));

vi.mock('$lib/server/push/subscription', () => ({
	listPushSubscriptionsForUser: listPushSubscriptionsForUserMock
}));

vi.mock('$lib/server/grounding/next-check-in', () => ({
	generateCheckInQuestion: generateCheckInQuestionMock
}));

vi.mock('$lib/server/push/send', () => ({
	sendPushToUser: sendPushToUserMock
}));

describe('maybeNotifyGroundingQuestionPush', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		isCheckInQuestionDueMock.mockResolvedValue(true);
		listPushSubscriptionsForUserMock.mockResolvedValue([{ id: 'sub1' }]);
		generateCheckInQuestionMock.mockResolvedValue({
			kind: 'grounding',
			facetKey: 'work',
			question: 'What kind of work do you do?'
		});
		sendPushToUserMock.mockResolvedValue({ sent: 1, failed: 0, removed: 0, errors: [] });
	});

	it('skips off-interval capture counts', async () => {
		await maybeNotifyGroundingQuestionPush('u1', 11);
		expect(isCheckInQuestionDueMock).not.toHaveBeenCalled();
	});

	it('sends grounding push with check-in link when due and subscribed', async () => {
		await maybeNotifyGroundingQuestionPush('u1', 10);

		expect(sendPushToUserMock).toHaveBeenCalledWith('u1', {
			title: 'Improve capture quality',
			body: 'What kind of work do you do?',
			url: '/capture?checkin=1',
			tag: 'check-in-question-10'
		});
	});

	it('uses memory-check title for relevance questions', async () => {
		generateCheckInQuestionMock.mockResolvedValue({
			kind: 'relevance',
			templateId: 'thought_still_relevant',
			thoughtId: 't1',
			snippet: 'Old note',
			question: 'Still relevant for you?'
		});

		await maybeNotifyGroundingQuestionPush('u1', 20);

		expect(sendPushToUserMock).toHaveBeenCalledWith('u1', {
			title: 'Quick memory check',
			body: 'Still relevant for you?',
			url: '/capture?checkin=1',
			tag: 'check-in-question-20'
		});
	});

	it('skips when not due', async () => {
		isCheckInQuestionDueMock.mockResolvedValue(false);
		await maybeNotifyGroundingQuestionPush('u1', 10);
		expect(sendPushToUserMock).not.toHaveBeenCalled();
	});

	it('skips when user has no push subscription', async () => {
		listPushSubscriptionsForUserMock.mockResolvedValue([]);
		await maybeNotifyGroundingQuestionPush('u1', 10);
		expect(sendPushToUserMock).not.toHaveBeenCalled();
	});
});
