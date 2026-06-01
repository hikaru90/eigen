import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeMock = vi.fn();
const getDbMock = vi.fn(() => ({ execute: executeMock }));
const logActivityCallMock = vi.fn();
const env = { AGE_GRAPH_NAME: 'eigen_graph' };

vi.mock('$env/dynamic/private', () => ({ env }));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

vi.mock('$lib/server/activity/log-call', () => ({
	logActivityCall: logActivityCallMock
}));

function mockCypherRows(rows: Array<Record<string, unknown>>) {
	executeMock
		.mockResolvedValueOnce({ rows: [] })
		.mockResolvedValueOnce({ rows: [] })
		.mockResolvedValueOnce(rows);
}

describe('graph adapter (Apache AGE)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		env.AGE_GRAPH_NAME = 'eigen_graph';
	});

	it('throws when AGE_GRAPH_NAME is missing', async () => {
		vi.resetModules();
		env.AGE_GRAPH_NAME = '';
		const { upsertThoughtNode } = await import('./age');
		await expect(
			upsertThoughtNode({ id: 't1', userId: 'u1', category: 'thought' })
		).rejects.toThrow(/AGE_GRAPH_NAME is required/);
	});

	it('upsertThoughtNode runs through AGE and logs activity', async () => {
		vi.resetModules();
		env.AGE_GRAPH_NAME = 'eigen_graph';
		mockCypherRows([{ id: 't1' }]);
		const { upsertThoughtNode } = await import('./age');
		await upsertThoughtNode({ id: 't1', userId: 'u1', category: 'thought' });
		expect(executeMock).toHaveBeenCalledTimes(3);
		expect(logActivityCallMock).toHaveBeenCalledWith(
			expect.anything(),
			'u1',
			expect.objectContaining({ provider: 'apache_age' })
		);
	});

	it('expandNeighborsByIds returns ranked thought hits', async () => {
		mockCypherRows([{ id: 't2', hits: 3 }]);
		const { expandNeighborsByIds } = await import('./age');
		const out = await expandNeighborsByIds({ userId: 'u1', seedIds: ['t1'], limit: 10 });
		expect(out).toEqual([{ id: 't2', hits: 3 }]);
	});

	it('graphOnlySearchByQuery short-circuits when query tokenization is empty', async () => {
		const { graphOnlySearchByQuery } = await import('./age');
		const out = await graphOnlySearchByQuery({ userId: 'u1', query: '!', limit: 10 });
		expect(out).toEqual([]);
		expect(executeMock).not.toHaveBeenCalled();
	});

	it('thoughtExistsInGraph returns true only when rows are returned', async () => {
		mockCypherRows([{ id: 't1' }]);
		const { thoughtExistsInGraph } = await import('./age');
		await expect(thoughtExistsInGraph('u1', 't1')).resolves.toBe(true);

		mockCypherRows([]);
		await expect(thoughtExistsInGraph('u1', 't2')).resolves.toBe(false);
	});
});
