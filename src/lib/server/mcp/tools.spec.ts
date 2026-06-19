import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	runCaptureThoughtTool,
	runCreateTextFileTool,
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
	getDbSelectMock,
	loadTemporalContextByThoughtIdsMock,
	createTextFileMock,
	searchTextFilesMock
} = vi.hoisted(() => ({
	searchThoughtsMock: vi.fn(),
	composeAnswerMock: vi.fn(),
	captureThoughtMock: vi.fn(),
	listThoughtsMock: vi.fn(),
	editStoredThoughtMock: vi.fn(),
	deleteThoughtForUserMock: vi.fn(),
	getDbSelectMock: vi.fn(),
	loadTemporalContextByThoughtIdsMock: vi.fn(),
	createTextFileMock: vi.fn(),
	searchTextFilesMock: vi.fn()
}));

vi.mock('$lib/server/memory/temporal-context', () => ({
	loadTemporalContextByThoughtIds: loadTemporalContextByThoughtIdsMock,
	compactTemporalFieldsForMcp: vi.fn((ctx: { temporalStatus: string; temporalEvents: unknown[] } | undefined, _now: Date) => {
		if (!ctx || ctx.temporalStatus === 'none') {
			return { temporalStatus: 'none', temporalSummary: undefined };
		}
		return {
			temporalStatus: ctx.temporalStatus,
			temporalSummary: '"task" (Jun 2, 2026) — EXPIRED'
		};
	}),
	enhanceSnippetWithTemporalContext: vi.fn(
		(input: { snippet: string; storedAt: Date; temporalSummary?: string }) =>
			`${input.snippet} (stored ${input.storedAt.toISOString().slice(0, 10)}${input.temporalSummary ? `; ${input.temporalSummary}` : ''})`
	)
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

vi.mock('$lib/server/text-files/service', () => ({
	createTextFile: createTextFileMock,
	searchTextFiles: searchTextFilesMock
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
		loadTemporalContextByThoughtIdsMock.mockResolvedValue(new Map());
		searchTextFilesMock.mockResolvedValue([]);
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

	it('runCaptureThoughtTool persists raw and returns id+status+thought', async () => {
		captureThoughtMock.mockResolvedValue({
			id: 't1',
			normalizedText: 'hi',
			queueStatus: 'pending'
		});
		const out = await runCaptureThoughtTool({ userId: 'u1' }, { raw: 'hi' });
		expect(captureThoughtMock).toHaveBeenCalledWith('u1', 'hi', { source: 'mcp' });
		expect(out).toEqual({
			thoughtId: 't1',
			status: 'pending',
			thought: { id: 't1', normalizedText: 'hi', queueStatus: 'pending' }
		});
	});

	it('runCaptureThoughtTool rejects empty/whitespace raw and non-object args', async () => {
		await expect(runCaptureThoughtTool({ userId: 'u1' }, { raw: '   ' })).rejects.toThrow(
			/raw is required/
		);
		await expect(runCaptureThoughtTool({ userId: 'u1' }, null)).rejects.toThrow(/raw is required/);
	});

	it('runListThoughtsTool returns snippet shape by default', async () => {
		listThoughtsMock.mockResolvedValue([
			{
				id: 't1',
				normalizedText: 'hello world',
				category: 'thought',
				createdAt: new Date('2024-01-01'),
				embedding: Array.from({ length: 1536 }, () => 0.1)
			}
		]);
		const out = (await runListThoughtsTool({ userId: 'u1' }, {})) as {
			count: number;
			thoughts: Array<Record<string, unknown>>;
		};
		expect(listThoughtsMock).toHaveBeenCalledWith('u1', {
			limit: 20,
			fields: 'snippet',
			cursor: undefined
		});
		expect(out.count).toBe(1);
		expect(out.thoughts[0]).toMatchObject({
			id: 't1',
			category: 'thought',
			snippet: expect.stringContaining('hello world'),
			temporalStatus: 'none',
			createdAt: '2024-01-01T00:00:00.000Z'
		});
	});

	it('runListThoughtsTool forwards detail=full', async () => {
		listThoughtsMock.mockResolvedValue([{ id: 't1', normalizedText: 'hello' }]);
		await runListThoughtsTool({ userId: 'u1' }, { detail: 'full' });
		expect(listThoughtsMock).toHaveBeenCalledWith('u1', {
			limit: 20,
			fields: 'full',
			cursor: undefined
		});
	});

	it('runListThoughtsTool forwards explicit limit and cursor when both halves are present', async () => {
		listThoughtsMock.mockResolvedValue([]);
		await runListThoughtsTool(
			{ userId: 'u1' },
			{ limit: 5, cursor_created_at: '2024-01-01T00:00:00.000Z', cursor_id: 't9' }
		);
		expect(listThoughtsMock).toHaveBeenCalledWith('u1', {
			limit: 5,
			fields: 'snippet',
			cursor: { createdAt: new Date('2024-01-01T00:00:00.000Z'), id: 't9' }
		});
	});

	it('runRetrieveThoughtsTool rejects missing/whitespace query', async () => {
		await expect(runRetrieveThoughtsTool({ userId: 'u1' }, { query: '   ' })).rejects.toThrow(
			/query is required/
		);
	});

	it('runRetrieveThoughtsTool uses fast mode and snippet shape by default', async () => {
		searchThoughtsMock.mockResolvedValue([
			{
				id: 'a',
				normalizedText: 'long normalized text here',
				category: 'thought',
				score: 0.02,
				vectorScore: 0.02,
				graphScore: 0,
				createdAt: new Date('2026-06-02T10:00:00.000Z')
			}
		]);
		const out = (await runRetrieveThoughtsTool({ userId: 'u1' }, { query: 'hello' })) as {
			count: number;
			results: Array<Record<string, unknown>>;
		};
		expect(searchThoughtsMock).toHaveBeenCalledWith({
			userId: 'u1',
			query: 'hello',
			topK: 10
		});
		expect(out.count).toBe(1);
		expect(out.results[0]).toMatchObject({
			id: 'a',
			category: 'thought',
			temporalStatus: 'none',
			createdAt: '2026-06-02T10:00:00.000Z'
		});
		expect(out.results[0].snippet).toContain('stored 2026-06-02');
		expect(out.results[0]).not.toHaveProperty('normalizedText');
	});

	it('runRetrieveThoughtsTool includes temporal expiry fields when events exist', async () => {
		searchThoughtsMock.mockResolvedValue([
			{
				id: 'a',
				normalizedText: 'ich würde heute nachmittag die app trennen',
				category: 'task',
				score: 0.02,
				vectorScore: 0.02,
				graphScore: 0,
				createdAt: new Date('2026-06-02T10:00:00.000Z')
			}
		]);
		loadTemporalContextByThoughtIdsMock.mockResolvedValue(
			new Map([
				[
					'a',
					{
						temporalStatus: 'expired',
						temporalEvents: [
							{
								kind: 'reminder',
								semanticSummary: 'separate app',
								activePeriod: '[2026-06-02T12:00:00.000Z,2026-06-02T18:00:00.000Z)',
								expired: true
							}
						]
					}
				]
			])
		);
		const out = (await runRetrieveThoughtsTool({ userId: 'u1' }, { query: 'task' })) as {
			results: Array<Record<string, unknown>>;
		};
		expect(out.results[0]).toMatchObject({
			temporalStatus: 'expired',
			temporalSummary: expect.stringContaining('EXPIRED')
		});
	});

	it('runRetrieveThoughtsTool passes relational queries through to searchThoughts', async () => {
		searchThoughtsMock.mockResolvedValue([]);
		await runRetrieveThoughtsTool({ userId: 'u1' }, { query: 'Who is Jonas?' });
		expect(searchThoughtsMock).toHaveBeenCalledWith({
			userId: 'u1',
			query: 'Who is Jonas?',
			topK: 10
		});
	});

	it('runRetrieveThoughtsTool filters by normalized RRF threshold when provided', async () => {
		searchThoughtsMock.mockResolvedValue([
			{
				id: 'a',
				normalizedText: 'A',
				category: 'thought',
				score: 0.6,
				vectorScore: 0.6,
				graphScore: 0,
				createdAt: new Date('2026-06-02T10:00:00.000Z')
			},
			{
				id: 'b',
				normalizedText: 'B',
				category: 'thought',
				score: 0.2,
				vectorScore: 0.2,
				graphScore: 0,
				createdAt: new Date('2026-06-02T10:00:00.000Z')
			}
		]);
		const out = (await runRetrieveThoughtsTool(
			{ userId: 'u1' },
			{ query: 'hi', top_k: 5, threshold: 0.5 }
		)) as { results: Array<{ id: string }> };
		expect(out.results).toEqual([
			{
				id: 'a',
				category: 'thought',
				snippet: expect.stringContaining('A'),
				scoreNormalized: expect.any(Number),
				createdAt: '2026-06-02T10:00:00.000Z',
				temporalStatus: 'none'
			}
		]);
	});

	it('runDeleteThoughtTool deletes by thought_id', async () => {
		deleteThoughtForUserMock.mockResolvedValue({ ok: true });
		const out = await runDeleteThoughtTool({ userId: 'u1' }, { thought_id: 't1' });
		expect(deleteThoughtForUserMock).toHaveBeenCalledWith('u1', 't1');
		expect(out).toEqual({ deleted: true, thoughtId: 't1' });
	});

	it('runDeleteThoughtTool accepts id alias from compact retrieve candidates', async () => {
		deleteThoughtForUserMock.mockResolvedValue({ ok: true });
		const out = await runDeleteThoughtTool(
			{ userId: 'u1' },
			{ id: '829b4cc7-ee30-403f-975b-f4663f52eb00' }
		);
		expect(deleteThoughtForUserMock).toHaveBeenCalledWith(
			'u1',
			'829b4cc7-ee30-403f-975b-f4663f52eb00'
		);
		expect(out).toEqual({
			deleted: true,
			thoughtId: '829b4cc7-ee30-403f-975b-f4663f52eb00'
		});
	});

	it('runAnswerQuestionTool calls composeAnswer and returns result', async () => {
		composeAnswerMock.mockResolvedValue({
			answer: 'Some answer.',
			citations: ['t1'],
			retrieved: []
		});
		const out = await runAnswerQuestionTool({ userId: 'u1' }, { question: 'what is X?' });
		expect(composeAnswerMock).toHaveBeenCalledWith(
			expect.objectContaining({ userId: 'u1', question: 'what is X?' })
		);
		expect(out.answer).toBe('Some answer.');
	});

	it('runCreateTextFileTool returns sanitized payload without embedding', async () => {
		createTextFileMock.mockResolvedValue({
			id: 'f1',
			title: 'Note',
			body: 'hello',
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z'
		});
		const out = await runCreateTextFileTool({ userId: 'u1' }, { body: 'hello', title: 'Note' });
		expect(out).toMatchObject({ textFileId: 'f1', textFile: { body: 'hello' } });
		expect(out).not.toHaveProperty('embedding');
	});
});
