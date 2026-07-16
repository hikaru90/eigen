import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET, POST } from './+server';

const {
	generateCheckInQuestionMock,
	getOnboardingWelcomeQuestionIfAvailableMock,
	isCheckInQuestionDueMock,
	touchCheckInQuestionPromptMock,
	saveGroundingQuestionAnswerMock,
	applyRelevanceCheckInAnswerMock
} = vi.hoisted(() => ({
	generateCheckInQuestionMock: vi.fn(),
	getOnboardingWelcomeQuestionIfAvailableMock: vi.fn(),
	isCheckInQuestionDueMock: vi.fn(),
	touchCheckInQuestionPromptMock: vi.fn(),
	saveGroundingQuestionAnswerMock: vi.fn(),
	applyRelevanceCheckInAnswerMock: vi.fn()
}));

vi.mock('$lib/server/grounding/next-check-in', () => ({
	generateCheckInQuestion: generateCheckInQuestionMock
}));

vi.mock('$lib/server/grounding/onboarding-welcome-push', () => ({
	getOnboardingWelcomeQuestionIfAvailable: getOnboardingWelcomeQuestionIfAvailableMock
}));

vi.mock('$lib/server/grounding/question-due', () => ({
	isCheckInQuestionDue: isCheckInQuestionDueMock,
	touchCheckInQuestionPrompt: touchCheckInQuestionPromptMock
}));

vi.mock('$lib/server/grounding/profile', () => ({
	saveGroundingQuestionAnswer: saveGroundingQuestionAnswerMock
}));

vi.mock('$lib/server/grounding/relevance-answer', () => ({
	applyRelevanceCheckInAnswer: applyRelevanceCheckInAnswerMock
}));

const VALID_THOUGHT_ID = '11111111-1111-4111-8111-111111111111';

function getEvent(user: { id: string } | null = { id: 'u1' }) {
	return { locals: { user } } as Parameters<typeof GET>[0];
}

function postEvent(overrides: { user?: { id: string } | null; body?: unknown } = {}) {
	return {
		locals: { user: overrides.user === undefined ? { id: 'u1' } : overrides.user },
		request: new Request('http://localhost/api/grounding/question', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(overrides.body ?? {})
		})
	} as Parameters<typeof POST>[0];
}

describe('GET /api/grounding/question', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns 401 when unauthenticated', async () => {
		await expect(GET(getEvent(null))).rejects.toMatchObject({ status: 401 });
	});

	it('returns a generated check-in question when due', async () => {
		isCheckInQuestionDueMock.mockResolvedValue(true);
		generateCheckInQuestionMock.mockResolvedValue({ facetKey: 'work', prompt: 'How is work?' });
		const res = await GET(getEvent());
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			due: true,
			question: { facetKey: 'work', prompt: 'How is work?' }
		});
	});

	it('touches the prompt and returns null question when due but nothing generated', async () => {
		isCheckInQuestionDueMock.mockResolvedValue(true);
		generateCheckInQuestionMock.mockResolvedValue(null);
		const res = await GET(getEvent());
		expect(touchCheckInQuestionPromptMock).toHaveBeenCalledWith('u1');
		expect(await res.json()).toEqual({ question: null, due: true });
	});

	it('returns onboarding welcome question when not due', async () => {
		isCheckInQuestionDueMock.mockResolvedValue(false);
		getOnboardingWelcomeQuestionIfAvailableMock.mockResolvedValue({ prompt: 'Welcome!' });
		const res = await GET(getEvent());
		expect(await res.json()).toEqual({ due: false, welcome: true, question: { prompt: 'Welcome!' } });
	});

	it('returns null question when nothing is due or available', async () => {
		isCheckInQuestionDueMock.mockResolvedValue(false);
		getOnboardingWelcomeQuestionIfAvailableMock.mockResolvedValue(null);
		const res = await GET(getEvent());
		expect(await res.json()).toEqual({ question: null, due: false });
	});
});

describe('POST /api/grounding/question', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns 401 when unauthenticated', async () => {
		await expect(POST(postEvent({ user: null }))).rejects.toMatchObject({ status: 401 });
	});

	it('returns 400 for invalid JSON body', async () => {
		await expect(
			POST({
				locals: { user: { id: 'u1' } },
				request: new Request('http://localhost', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: 'not-json'
				})
			} as Parameters<typeof POST>[0])
		).rejects.toMatchObject({ status: 400 });
	});

	it('dismisses the check-in prompt', async () => {
		const res = await POST(postEvent({ body: { dismiss: true } }));
		expect(touchCheckInQuestionPromptMock).toHaveBeenCalledWith('u1');
		expect(await res.json()).toEqual({ ok: true, dismissed: true });
	});

	it('rejects an invalid relevance thoughtId', async () => {
		await expect(
			POST(postEvent({ body: { kind: 'relevance', thoughtId: 'not-a-uuid', action: 'keep' } }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects an invalid relevance action', async () => {
		await expect(
			POST(
				postEvent({
					body: { kind: 'relevance', thoughtId: VALID_THOUGHT_ID, action: 'delete' }
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('applies a relevance check-in answer', async () => {
		applyRelevanceCheckInAnswerMock.mockResolvedValue({ ok: true, action: 'keep' });
		const res = await POST(
			postEvent({
				body: { kind: 'relevance', thoughtId: VALID_THOUGHT_ID, action: 'keep' }
			})
		);
		expect(applyRelevanceCheckInAnswerMock).toHaveBeenCalledWith({
			userId: 'u1',
			thoughtId: VALID_THOUGHT_ID,
			action: 'keep'
		});
		expect(touchCheckInQuestionPromptMock).toHaveBeenCalledWith('u1');
		expect(await res.json()).toEqual({ ok: true, kind: 'relevance', action: 'keep' });
	});

	it('returns 404 when relevance thought is not found', async () => {
		applyRelevanceCheckInAnswerMock.mockResolvedValue({ ok: false, reason: 'not_found' });
		await expect(
			POST(
				postEvent({
					body: { kind: 'relevance', thoughtId: VALID_THOUGHT_ID, action: 'archive' }
				})
			)
		).rejects.toMatchObject({ status: 404 });
	});

	it('returns 400 when relevance answer is otherwise invalid', async () => {
		applyRelevanceCheckInAnswerMock.mockResolvedValue({ ok: false, reason: 'invalid' });
		await expect(
			POST(
				postEvent({
					body: { kind: 'relevance', thoughtId: VALID_THOUGHT_ID, action: 'keep' }
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects an invalid facetKey for grounding answers', async () => {
		await expect(
			POST(postEvent({ body: { facetKey: 'not-a-facet', answer: 'yes' } }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects an empty answer', async () => {
		await expect(
			POST(postEvent({ body: { facetKey: 'work', answer: '  ' } }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('saves a grounding question answer', async () => {
		saveGroundingQuestionAnswerMock.mockResolvedValue(undefined);
		const res = await POST(postEvent({ body: { facetKey: 'work', answer: 'Busy but good' } }));
		expect(saveGroundingQuestionAnswerMock).toHaveBeenCalledWith({
			userId: 'u1',
			facetKey: 'work',
			answer: 'Busy but good'
		});
		expect(await res.json()).toEqual({ ok: true, kind: 'grounding' });
	});
});
