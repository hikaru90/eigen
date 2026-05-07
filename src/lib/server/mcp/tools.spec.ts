import { describe, expect, it, vi } from 'vitest';
import { runEditThoughtTool, runSearchThoughtsTool } from './tools';

const { searchThoughtsMock, editStoredThoughtMock } = vi.hoisted(() => ({
	searchThoughtsMock: vi.fn(),
	editStoredThoughtMock: vi.fn()
}));

vi.mock('$lib/server/retrieval/service', () => ({
	searchThoughts: searchThoughtsMock
}));

vi.mock('$lib/server/capture/service', () => ({
	captureThought: vi.fn(),
	listThoughts: vi.fn(),
	editStoredThought: editStoredThoughtMock
}));

describe('MCP tools', () => {
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
});
