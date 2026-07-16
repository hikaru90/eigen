import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	runCaptureThoughtTool,
	runCreateTextFileTool,
	runDeleteThoughtTool,
	runEditThoughtTool,
	runRetrieveThoughtsTool,
	runSearchTextFilesTool
} from './tools';

const {
	searchThoughtsMock,
	captureThoughtMock,
	listThoughtsMock,
	editStoredThoughtMock,
	archiveThoughtForUserMock,
	getDbSelectMock,
	loadTemporalContextByThoughtIdsMock,
	createTextFileMock,
	searchTextFilesMock,
	resolveMcpCaptureAuthorshipMock
} = vi.hoisted(() => ({
	searchThoughtsMock: vi.fn(),
	captureThoughtMock: vi.fn(),
	listThoughtsMock: vi.fn(),
	editStoredThoughtMock: vi.fn(),
	archiveThoughtForUserMock: vi.fn(),
	getDbSelectMock: vi.fn(),
	loadTemporalContextByThoughtIdsMock: vi.fn(),
	createTextFileMock: vi.fn(),
	searchTextFilesMock: vi.fn(),
	resolveMcpCaptureAuthorshipMock: vi.fn()
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

vi.mock('$lib/server/capture/service', () => ({
	captureThought: captureThoughtMock,
	listThoughts: listThoughtsMock,
	editStoredThought: editStoredThoughtMock
}));

vi.mock('$lib/server/memory/lifecycle', () => ({
	archiveThoughtForUser: archiveThoughtForUserMock
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

vi.mock('$lib/server/memory/authorship', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/memory/authorship')>();
	return {
		...actual,
		resolveMcpCaptureAuthorship: resolveMcpCaptureAuthorshipMock
	};
});

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
		resolveMcpCaptureAuthorshipMock.mockResolvedValue({
			author: 'user',
			authorLabel: null,
			authorKeyId: null
		});
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
		expect(captureThoughtMock).toHaveBeenCalledWith('u1', 'hi', {
			source: 'mcp',
			author: 'user',
			authorLabel: null,
			authorKeyId: null
		});
		expect(out).toEqual({
			thoughtId: 't1',
			status: 'pending',
			thought: { id: 't1', normalizedText: 'hi', queueStatus: 'pending' }
		});
	});

	it('runCaptureThoughtTool labels agent authorship from MCP Bearer API key', async () => {
		captureThoughtMock.mockResolvedValue({ id: 't1', queueStatus: 'pending' });
		resolveMcpCaptureAuthorshipMock.mockResolvedValue({
			author: 'agent',
			authorLabel: 'Cursor',
			authorKeyId: 'key-1'
		});
		await runCaptureThoughtTool(
			{ userId: 'u1', authenticatedApiKey: { id: 'key-1', name: 'Cursor' } },
			{ raw: 'agent note' }
		);
		expect(resolveMcpCaptureAuthorshipMock).toHaveBeenCalledWith({
			authorPrefix: undefined,
			asUser: false,
			authenticatedApiKey: { id: 'key-1', name: 'Cursor' }
		});
		expect(captureThoughtMock).toHaveBeenCalledWith('u1', 'agent note', {
			source: 'agent',
			author: 'agent',
			authorLabel: 'Cursor',
			authorKeyId: 'key-1'
		});
	});

	it('runCaptureThoughtTool honors as_user on MCP API key auth', async () => {
		captureThoughtMock.mockResolvedValue({ id: 't1', queueStatus: 'pending' });
		await runCaptureThoughtTool(
			{ userId: 'u1', authenticatedApiKey: { id: 'key-1', name: 'Cursor' } },
			{ raw: 'human note', as_user: true }
		);
		expect(captureThoughtMock).toHaveBeenCalledWith('u1', 'human note', {
			source: 'mcp',
			author: 'user',
			authorLabel: null,
			authorKeyId: null
		});
	});

	it('runCaptureThoughtTool rejects empty/whitespace raw and non-object args', async () => {
		await expect(runCaptureThoughtTool({ userId: 'u1' }, { raw: '   ' })).rejects.toThrow(
			/raw is required/
		);
		await expect(runCaptureThoughtTool({ userId: 'u1' }, null)).rejects.toThrow(/raw is required/);
	});

	it('runRetrieveThoughtsTool lists recent thoughts when query is omitted', async () => {
		listThoughtsMock.mockResolvedValue([
			{
				id: 't1',
				normalizedText: 'hello world',
				category: 'thought',
				createdAt: new Date('2024-01-01'),
				embedding: Array.from({ length: 1536 }, () => 0.1)
			}
		]);
		const out = (await runRetrieveThoughtsTool({ userId: 'u1' }, { top_k: 5 })) as {
			count: number;
			results: Array<Record<string, unknown>>;
		};
		expect(searchThoughtsMock).not.toHaveBeenCalled();
		expect(listThoughtsMock).toHaveBeenCalledWith('u1', {
			limit: 5,
			fields: 'snippet',
			cursor: undefined,
			authorFilter: 'user'
		});
		expect(out.count).toBe(1);
		expect(out.results[0]).toMatchObject({
			id: 't1',
			category: 'thought',
			snippet: expect.stringContaining('hello world'),
			temporalStatus: 'none',
			createdAt: '2024-01-01T00:00:00.000Z'
		});
	});

	it('runRetrieveThoughtsTool treats whitespace-only query as recent browse', async () => {
		listThoughtsMock.mockResolvedValue([]);
		await runRetrieveThoughtsTool({ userId: 'u1' }, { query: '   ', top_k: 3 });
		expect(listThoughtsMock).toHaveBeenCalledWith('u1', {
			limit: 3,
			fields: 'snippet',
			cursor: undefined,
			authorFilter: 'user'
		});
		expect(searchThoughtsMock).not.toHaveBeenCalled();
	});

	it('runRetrieveThoughtsTool uses recent browse when order is created_at even with a query', async () => {
		listThoughtsMock.mockResolvedValue([]);
		await runRetrieveThoughtsTool(
			{ userId: 'u1' },
			{ query: 'eigenmesh recent thoughts', order: 'created_at', top_k: 10 }
		);
		expect(listThoughtsMock).toHaveBeenCalledWith('u1', {
			limit: 10,
			fields: 'snippet',
			cursor: undefined,
			authorFilter: 'user'
		});
		expect(searchThoughtsMock).not.toHaveBeenCalled();
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
			topK: 10,
			authorFilter: 'user'
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
			topK: 10,
			authorFilter: 'user'
		});
	});

	it('runRetrieveThoughtsTool omits authorFilter when author is all', async () => {
		searchThoughtsMock.mockResolvedValue([]);
		await runRetrieveThoughtsTool({ userId: 'u1' }, { query: 'hello', author: 'all' });
		expect(searchThoughtsMock).toHaveBeenCalledWith({
			userId: 'u1',
			query: 'hello',
			topK: 10
		});
		expect(searchTextFilesMock).toHaveBeenCalledWith('u1', {
			query: 'hello',
			topK: 10
		});
	});

	it('runRetrieveThoughtsTool omits authorFilter when include_agent is true', async () => {
		searchThoughtsMock.mockResolvedValue([]);
		await runRetrieveThoughtsTool({ userId: 'u1' }, { query: 'hello', include_agent: true });
		expect(searchThoughtsMock).toHaveBeenCalledWith({
			userId: 'u1',
			query: 'hello',
			topK: 10
		});
	});

	it('runRetrieveThoughtsTool passes authorFilter agent when requested', async () => {
		searchThoughtsMock.mockResolvedValue([]);
		await runRetrieveThoughtsTool({ userId: 'u1' }, { query: 'hello', author: 'agent' });
		expect(searchThoughtsMock).toHaveBeenCalledWith({
			userId: 'u1',
			query: 'hello',
			topK: 10,
			authorFilter: 'agent'
		});
		expect(searchTextFilesMock).toHaveBeenCalledWith('u1', {
			query: 'hello',
			topK: 10,
			authorFilter: 'agent'
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

	it('runDeleteThoughtTool soft-archives by thought_id', async () => {
		archiveThoughtForUserMock.mockResolvedValue({ ok: true });
		const out = await runDeleteThoughtTool({ userId: 'u1' }, { thought_id: 't1' });
		expect(archiveThoughtForUserMock).toHaveBeenCalledWith('u1', 't1');
		expect(out).toEqual({ archived: true, thoughtId: 't1', status: 'archived' });
	});

	it('runDeleteThoughtTool accepts id alias from compact retrieve candidates', async () => {
		archiveThoughtForUserMock.mockResolvedValue({ ok: true });
		const out = await runDeleteThoughtTool(
			{ userId: 'u1' },
			{ id: '829b4cc7-ee30-403f-975b-f4663f52eb00' }
		);
		expect(archiveThoughtForUserMock).toHaveBeenCalledWith(
			'u1',
			'829b4cc7-ee30-403f-975b-f4663f52eb00'
		);
		expect(out).toEqual({
			archived: true,
			thoughtId: '829b4cc7-ee30-403f-975b-f4663f52eb00',
			status: 'archived'
		});
	});

	it('runCaptureThoughtTool resolves author prefix to agent authorship', async () => {
		resolveMcpCaptureAuthorshipMock.mockResolvedValue({
			author: 'agent',
			authorLabel: 'cursor',
			authorKeyId: 'key-1'
		});
		captureThoughtMock.mockResolvedValue({ id: 't1', queueStatus: 'pending' });
		await runCaptureThoughtTool({ userId: 'u1' }, { raw: 'hi', author: 'eigen_abcd' });
		expect(resolveMcpCaptureAuthorshipMock).toHaveBeenCalledWith({
			authorPrefix: 'eigen_abcd',
			asUser: false,
			authenticatedApiKey: undefined
		});
		expect(captureThoughtMock).toHaveBeenCalledWith('u1', 'hi', {
			source: 'agent',
			author: 'agent',
			authorLabel: 'cursor',
			authorKeyId: 'key-1'
		});
	});

	it('runCaptureThoughtTool rejects unknown author prefix', async () => {
		resolveMcpCaptureAuthorshipMock.mockRejectedValue(
			new Error('No API key matches author prefix "bad"')
		);
		await expect(
			runCaptureThoughtTool({ userId: 'u1' }, { raw: 'hi', author: 'bad' })
		).rejects.toThrow(/No API key matches/);
	});

	it('runCreateTextFileTool passes resolved authorship', async () => {
		resolveMcpCaptureAuthorshipMock.mockResolvedValue({
			author: 'agent',
			authorLabel: 'claude',
			authorKeyId: 'key-1'
		});
		createTextFileMock.mockResolvedValue({
			id: 'f1',
			title: 'Note',
			body: 'hello',
			author: 'agent',
			authorLabel: 'claude',
			authorKeyId: 'key-1',
			createdAt: '2026-07-16T00:00:00.000Z',
			updatedAt: '2026-07-16T00:00:00.000Z'
		});
		await runCreateTextFileTool(
			{ userId: 'u1' },
			{ body: 'hello', title: 'Note', author: 'eigen_xyz' }
		);
		expect(createTextFileMock).toHaveBeenCalledWith('u1', {
			title: 'Note',
			body: 'hello',
			authorship: {
				author: 'agent',
				authorLabel: 'claude',
				authorKeyId: 'key-1'
			}
		});
	});

	it('runCreateTextFileTool returns sanitized payload without embedding', async () => {
		createTextFileMock.mockResolvedValue({
			id: 'f1',
			title: 'Note',
			body: 'hello',
			author: 'user',
			authorLabel: null,
			authorKeyId: null,
			createdAt: '2026-07-16T00:00:00.000Z',
			updatedAt: '2026-07-16T00:00:00.000Z'
		});
		const out = await runCreateTextFileTool({ userId: 'u1' }, { body: 'hello', title: 'Note' });
		expect(out).toMatchObject({ textFileId: 'f1', textFile: { body: 'hello' } });
		expect(out).not.toHaveProperty('embedding');
	});

	it('runCreateTextFileTool accepts title-only notes', async () => {
		createTextFileMock.mockResolvedValue({
			id: 'f2',
			title: 'shopping list',
			body: '',
			author: 'user',
			authorLabel: null,
			authorKeyId: null,
			createdAt: '2026-07-16T00:00:00.000Z',
			updatedAt: '2026-07-16T00:00:00.000Z'
		});
		const out = await runCreateTextFileTool({ userId: 'u1' }, { title: 'shopping list' });
		expect(createTextFileMock).toHaveBeenCalledWith(
			'u1',
			expect.objectContaining({ title: 'shopping list', body: undefined })
		);
		expect(out).toMatchObject({ textFileId: 'f2', textFile: { title: 'shopping list', body: '' } });
	});

	it('runCreateTextFileTool rejects when title and body are both empty', async () => {
		await expect(runCreateTextFileTool({ userId: 'u1' }, {})).rejects.toThrow(
			/title or body is required/
		);
		expect(createTextFileMock).not.toHaveBeenCalled();
	});

	it('runSearchTextFilesTool searches notes with author filter', async () => {
		searchTextFilesMock.mockResolvedValue([{ id: 'f1', title: 'R', preview: 'x', lexicalScore: 1 }]);
		const out = await runSearchTextFilesTool(
			{ userId: 'u1' },
			{ query: 'hello', top_k: 10, author: 'agent' }
		);
		expect(searchTextFilesMock).toHaveBeenCalledWith('u1', {
			query: 'hello',
			topK: 10,
			authorFilter: 'agent'
		});
		expect(out).toMatchObject({ count: 1 });
	});
});
