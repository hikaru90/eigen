import { beforeEach, describe, expect, it, vi } from 'vitest';
import { maybeNotifyGroundingQuestionPush } from '$lib/server/grounding/notify-question';

const {
	isGroundingQuestionDueMock,
	listPushSubscriptionsForUserMock,
	generateGroundingQuestionMock,
	sendPushToUserMock
} = vi.hoisted(() => ({
	isGroundingQuestionDueMock: vi.fn(),
	listPushSubscriptionsForUserMock: vi.fn(),
	generateGroundingQuestionMock: vi.fn(),
	sendPushToUserMock: vi.fn()
}));

vi.mock('$lib/server/grounding/question-due', () => ({
	isGroundingQuestionDue: isGroundingQuestionDueMock
}));

vi.mock('$lib/server/push/subscription', () => ({
	listPushSubscriptionsForUser: listPushSubscriptionsForUserMock
}));

vi.mock('$lib/server/grounding/next-question', () => ({
	generateGroundingQuestion: generateGroundingQuestionMock
}));

vi.mock('$lib/server/push/send', () => ({
	sendPushToUser: sendPushToUserMock
}));

describe('maybeNotifyGroundingQuestionPush', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		isGroundingQuestionDueMock.mockResolvedValue(true);
		listPushSubscriptionsForUserMock.mockResolvedValue([{ id: 'sub1' }]);
		generateGroundingQuestionMock.mockResolvedValue({
			facetKey: 'work',
			question: 'What kind of work do you do?'
		});
		sendPushToUserMock.mockResolvedValue({ sent: 1, failed: 0, removed: 0, errors: [] });
	});

	it('skips off-interval capture counts', async () => {
		await maybeNotifyGroundingQuestionPush('u1', 11);
		expect(isGroundingQuestionDueMock).not.toHaveBeenCalled();
	});

	it('sends push with capture link when due and subscribed', async () => {
		await maybeNotifyGroundingQuestionPush('u1', 10);

		expect(sendPushToUserMock).toHaveBeenCalledWith('u1', {
			title: 'Help Eigen understand you',
			body: 'What kind of work do you do?',
			url: '/capture?grounding=1',
			tag: 'grounding-question-10'
		});
	});

	it('skips when not due', async () => {
		isGroundingQuestionDueMock.mockResolvedValue(false);
		await maybeNotifyGroundingQuestionPush('u1', 10);
		expect(sendPushToUserMock).not.toHaveBeenCalled();
	});

	it('skips when user has no push subscription', async () => {
		listPushSubscriptionsForUserMock.mockResolvedValue([]);
		await maybeNotifyGroundingQuestionPush('u1', 10);
		expect(sendPushToUserMock).not.toHaveBeenCalled();
	});
});
