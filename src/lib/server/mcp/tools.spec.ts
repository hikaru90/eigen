import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	runCaptureThoughtTool,
	runDeleteThoughtTool,
	runEditThoughtTool,
	runListThoughtsTool,
	runRetrieveThoughtsTool,
	runAnswerQuestionTool
} from './tools';

const {
	searchThoughtsMock,
	composeAnswerMock,
	captureThoughtMock,
	listThoughtsMock,
	editStoredThoughtMock,
	deleteThoughtForUserMock,
	getDbSelectMock
} = vi.hoisted(() => ({
	searchThoughtsMock: vi.fn(),
	composeAnswerMock: vi.fn(),
	captureThoughtMock: vi.fn(),
	listThoughtsMock: vi.fn(),
	editStoredThoughtMock: vi.fn(),
	deleteThoughtForUserMock: vi.fn(),
	getDbSelectMock: vi.fn()
}));

vi.mock('$lib/server/retrieval/service', () => ({
	searchThoughts: searchThoughtsMock
}));

vi.mock('$lib/server/qa/compose-answer', () => ({
	composeAnswer: composeAnswerMock
}));

vi.mock('$lib/server/capture/service', () => ({
	captureThought: captureThoughtMock,
	listThoughts: listThoughtsMock,
	editStoredThought: editStoredThoughtMock,
	deleteThoughtForUser: deleteThoughtForUserMock
}));

vi.mock('$lib/server/db', () => ({
	getDb: () => ({
		select: getDbSelectMock
	})
}));

function mockThoughtRow(row: Record<string, unknown> | null) {
	getDbSelectMock.mockReturnValue({
		from: vi.fn(() => ({
			where: vi.fn(() => ({
				limit: vi.fn(async () => (row ? [row] : []))
			}))
		}))
	});
}

describe('MCP tools', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('rejects invalid search threshold', async () => {
		await expect(
			runRetrieveThoughtsTool({ userId: 'u1' }, { query: 'x', threshold: 2 })
		).rejects.toThrow(/Invalid threshold/);
	});

	it('rejects whitespace thought_id', async () => {
		await expect(
			runEditThoughtTool({ userId: 'u1' }, { thought_id: '  ', edit_request: 'fix' })
		).rejects.toThrow(/Invalid thought_id/);
	});

	it('returns thought not found as error', async () => {
		mockThoughtRow(null);
		await expect(
			runEditThoughtTool({ userId: 'u1' }, { thought_id: 't1', edit_request: 'fix' })
		).rejects.toThrow(/Thought not found/);
		expect(editStoredThoughtMock).not.toHaveBeenCalled();
	});

	it('runCaptureThoughtTool persists raw and returns id+thought', async () => {
		captureThoughtMock.mockResolvedValue({ id: 't1', normalizedText: 'hi' });
		const out = await runCaptureThoughtTool({ userId: 'u1' }, { raw: 'hi' });
		expect(captureThoughtMock).toHaveBeenCalledWith('u1', 'hi');
		expect(out).toEqual({ thoughtId: 't1', thought: { id: 't1', normalizedText: 'hi' } });
	});

	it('runCaptureThoughtTool rejects empty/whitespace raw and non-object args', async () => {
		await expect(runCaptureThoughtTool({ userId: 'u1' }, { raw: '   ' })).rejects.toThrow(
			/raw is required/
		);
		await expect(runCaptureThoughtTool({ userId: 'u1' }, null)).rejects.toThrow(/raw is required/);
	});

	it('runListThoughtsTool forwards default limit when not provided', async () => {
		listThoughtsMock.mockResolvedValue([{ id: 't1' }]);
		const out = await runListThoughtsTool({ userId: 'u1' }, {});
		expect(listThoughtsMock).toHaveBeenCalledWith('u1', { limit: 20, cursor: undefined });
		expect(out).toEqual({ thoughts: [{ id: 't1' }] });
	});

	it('runListThoughtsTool forwards explicit limit and cursor when both halves are present', async () => {
		listThoughtsMock.mockResolvedValue([]);
		await runListThoughtsTool(
			{ userId: 'u1' },
			{ limit: 5, cursor_created_at: '2024-01-01T00:00:00.000Z', cursor_id: 't9' }
		);
		expect(listThoughtsMock).toHaveBeenCalledWith('u1', {
			limit: 5,
			cursor: { createdAt: new Date('2024-01-01T00:00:00.000Z'), id: 't9' }
		});
	});

	it('runListThoughtsTool omits cursor when only one half is provided', async () => {
		listThoughtsMock.mockResolvedValue([]);
		await runListThoughtsTool({ userId: 'u1' }, { cursor_created_at: '2024-01-01T00:00:00.000Z' });
		expect(listThoughtsMock).toHaveBeenCalledWith('u1', { limit: 20, cursor: undefined });
	});

	it('runRetrieveThoughtsTool rejects missing/whitespace query', async () => {
		await expect(runRetrieveThoughtsTool({ userId: 'u1' }, { query: '   ' })).rejects.toThrow(
			/query is required/
		);
	});

	it('runRetrieveThoughtsTool filters by threshold when provided', async () => {
		searchThoughtsMock.mockResolvedValue([
			{ id: 'a', score: 0.9 },
			{ id: 'b', score: 0.4 }
		]);
		const out = await runRetrieveThoughtsTool(
			{ userId: 'u1' },
			{ query: 'hi', top_k: 5, threshold: 0.5 }
		);
		expect(searchThoughtsMock).toHaveBeenCalledWith({
			userId: 'u1',
			query: 'hi',
			topK: 5,
			weights: { vector: 0.7, graph: 0.3 }
		});
		expect(out).toEqual({ results: [{ id: 'a', score: 0.9 }] });
	});

	it('runRetrieveThoughtsTool returns all results when threshold is omitted', async () => {
		searchThoughtsMock.mockResolvedValue([{ id: 'a', score: 0.1 }]);
		const out = await runRetrieveThoughtsTool({ userId: 'u1' }, { query: 'hi' });
		expect(out.results).toHaveLength(1);
	});

	it('runDeleteThoughtTool deletes by thought_id', async () => {
		deleteThoughtForUserMock.mockResolvedValue({ ok: true });
		const out = await runDeleteThoughtTool({ userId: 'u1' }, { thought_id: 't1' });
		expect(deleteThoughtForUserMock).toHaveBeenCalledWith('u1', 't1');
		expect(out).toEqual({ deleted: true, thoughtId: 't1' });
	});

	it('runDeleteThoughtTool throws when thought not found', async () => {
		deleteThoughtForUserMock.mockResolvedValue({ ok: false, reason: 'not_found' });
		await expect(
			runDeleteThoughtTool({ userId: 'u1' }, { thought_id: 'missing' })
		).rejects.toThrow(/Thought not found/);
	});

	it('runEditThoughtTool rejects empty edit_request', async () => {
		await expect(
			runEditThoughtTool({ userId: 'u1' }, { thought_id: 't1', edit_request: '   ' })
		).rejects.toThrow(/edit_request is required/);
	});

	it('runEditThoughtTool returns the updated thought on success', async () => {
		mockThoughtRow({
			id: 't1',
			rawText: 'old',
			normalizedText: 'old',
			category: 'task',
			metadata: { status: 'open' }
		});
		editStoredThoughtMock.mockResolvedValue({
			ok: true,
			thought: {
				id: 't1',
				rawText: 'new',
				normalizedText: 'new',
				category: 'task',
				metadata: { status: 'open' }
			},
			editSummary: 'Fixed typo.'
		});
		const out = await runEditThoughtTool(
			{ userId: 'u1' },
			{ thought_id: 't1', edit_request: 'fix typo' }
		);
		expect(out.summary).toBe('Fixed typo.');
		expect(out.thoughtId).toBe('t1');
		expect(out.before.normalizedText).toBe('old');
	});

	it('runAnswerQuestionTool rejects empty question', async () => {
		await expect(
			runAnswerQuestionTool({ userId: 'u1' }, { question: '   ' })
		).rejects.toThrow(/question is required/);
	});

	it('runAnswerQuestionTool calls composeAnswer and returns result', async () => {
		composeAnswerMock.mockResolvedValue({
			answer: 'Some answer.',
			citations: ['t1'],
			retrieved: [{ id: 't1', normalizedText: 'text', category: 'idea', score: 0.9, vectorScore: 0.7, graphScore: 0.2 }]
		});
		const out = await runAnswerQuestionTool({ userId: 'u1' }, { question: 'what is X?' });
		expect(composeAnswerMock).toHaveBeenCalledWith(
			expect.objectContaining({ userId: 'u1', question: 'what is X?' })
		);
		expect(out.answer).toBe('Some answer.');
		expect(out.citations).toEqual(['t1']);
	});

	it('runAnswerQuestionTool forwards top_k when provided', async () => {
		composeAnswerMock.mockResolvedValue({
			answer: 'Y.',
			citations: [],
			retrieved: []
		});
		await runAnswerQuestionTool({ userId: 'u1' }, { question: 'Y?', top_k: 5 });
		expect(composeAnswerMock).toHaveBeenCalledWith(
			expect.objectContaining({ userId: 'u1', question: 'Y?', topK: 5 })
		);
	});
});
