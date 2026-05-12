import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	runCaptureThoughtTool,
	runEditThoughtTool,
	runListThoughtsTool,
	runSearchThoughtsTool
} from './tools';

const { searchThoughtsMock, captureThoughtMock, listThoughtsMock, editStoredThoughtMock } =
	vi.hoisted(() => ({
		searchThoughtsMock: vi.fn(),
		captureThoughtMock: vi.fn(),
		listThoughtsMock: vi.fn(),
		editStoredThoughtMock: vi.fn()
	}));

vi.mock('$lib/server/retrieval/service', () => ({
	searchThoughts: searchThoughtsMock
}));

vi.mock('$lib/server/capture/service', () => ({
	captureThought: captureThoughtMock,
	listThoughts: listThoughtsMock,
	editStoredThought: editStoredThoughtMock
}));

describe('MCP tools', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('rejects invalid search threshold', async () => {
		await expect(
			runSearchThoughtsTool({ userId: 'u1' }, { query: 'x', threshold: 2 })
		).rejects.toThrow(/Invalid threshold/);
	});

	it('rejects whitespace thought_id', async () => {
		await expect(
			runEditThoughtTool({ userId: 'u1' }, { thought_id: '  ', edit_request: 'fix' })
		).rejects.toThrow(/Invalid thought_id/);
	});

	it('returns thought not found as error', async () => {
		editStoredThoughtMock.mockResolvedValue({ ok: false, reason: 'not_found' });
		await expect(
			runEditThoughtTool({ userId: 'u1' }, { thought_id: 't1', edit_request: 'fix' })
		).rejects.toThrow(/Thought not found/);
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

	it('runSearchThoughtsTool rejects missing/whitespace query', async () => {
		await expect(runSearchThoughtsTool({ userId: 'u1' }, { query: '   ' })).rejects.toThrow(
			/query is required/
		);
	});

	it('runSearchThoughtsTool filters by threshold when provided', async () => {
		searchThoughtsMock.mockResolvedValue([
			{ id: 'a', score: 0.9 },
			{ id: 'b', score: 0.4 }
		]);
		const out = await runSearchThoughtsTool(
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

	it('runSearchThoughtsTool returns all results when threshold is omitted', async () => {
		searchThoughtsMock.mockResolvedValue([{ id: 'a', score: 0.1 }]);
		const out = await runSearchThoughtsTool({ userId: 'u1' }, { query: 'hi' });
		expect(out.results).toHaveLength(1);
	});

	it('runEditThoughtTool rejects empty edit_request', async () => {
		await expect(
			runEditThoughtTool({ userId: 'u1' }, { thought_id: 't1', edit_request: '   ' })
		).rejects.toThrow(/edit_request is required/);
	});

	it('runEditThoughtTool returns the updated thought on success', async () => {
		editStoredThoughtMock.mockResolvedValue({ ok: true, thought: { id: 't1', rawText: 'new' } });
		const out = await runEditThoughtTool(
			{ userId: 'u1' },
			{ thought_id: 't1', edit_request: 'fix typo' }
		);
		expect(out).toEqual({ thought: { id: 't1', rawText: 'new' } });
	});
});
