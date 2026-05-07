import { beforeEach, describe, expect, it, vi } from 'vitest';

const connectMock = vi.fn();
const queryMock = vi.fn();
const selectGraphMock = vi.fn(() => ({ query: queryMock }));
const getDbMock = vi.fn(() => ({}));
const logActivityCallMock = vi.fn();
const env = {
	FALKOR_HOST: '',
	FALKOR_PORT: '',
	FALKOR_GRAPH: ''
};

vi.mock('falkordb', () => ({
	FalkorDB: {
		connect: connectMock
	}
}));

vi.mock('$env/dynamic/private', () => ({
	env
}));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

vi.mock('$lib/server/activity/log-call', () => ({
	logActivityCall: logActivityCallMock
}));

describe('upsertThoughtNode', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		env.FALKOR_HOST = '';
		env.FALKOR_PORT = '';
		env.FALKOR_GRAPH = '';
		connectMock.mockResolvedValue({ selectGraph: selectGraphMock });
		queryMock.mockResolvedValue({ data: [] });
	});

	it('uses defaults and sends expected query params', async () => {
		const { upsertThoughtNode } = await import('./falkor');
		await upsertThoughtNode({
			id: 't1',
			userId: 'u1',
			rawText: 'raw',
			normalizedText: 'normalized',
			lexicalText: 'lexical',
			category: 'thought'
		});

		expect(connectMock).toHaveBeenCalledWith({
			socket: { host: 'localhost', port: 6379 }
		});
		expect(selectGraphMock).toHaveBeenCalledWith('eigen_memory');
		expect(queryMock).toHaveBeenCalledWith(
			expect.stringContaining('MERGE (t:Thought {id: $id})'),
			expect.objectContaining({
				params: expect.objectContaining({
					id: 't1',
					user_id: 'u1'
				})
			})
		);
	});

	it('throws on invalid FALKOR_PORT', async () => {
		vi.resetModules();
		env.FALKOR_PORT = 'abc';
		const { upsertThoughtNode } = await import('./falkor');
		await expect(
			upsertThoughtNode({
				id: 't1',
				userId: 'u1',
				rawText: 'raw',
				normalizedText: 'normalized',
				lexicalText: 'lexical',
				category: 'thought'
			})
		).rejects.toThrow(/Invalid FALKOR_PORT/);
	});

	it('upserts thought relation', async () => {
		const { upsertThoughtRelation } = await import('./falkor');
		await upsertThoughtRelation({
			userId: 'u1',
			sourceId: 't1',
			targetId: 't2',
			relationType: 'related_to'
		});
		expect(queryMock).toHaveBeenCalledWith(
			expect.stringContaining('MERGE (a)-[r:RELATES_TO'),
			expect.objectContaining({
				params: expect.objectContaining({ source_id: 't1', target_id: 't2' })
			})
		);
	});

	it('returns expanded neighbors', async () => {
		queryMock.mockResolvedValueOnce({ data: [['t2', 3]] });
		const { expandNeighborsByIds } = await import('./falkor');
		const out = await expandNeighborsByIds({ userId: 'u1', seedIds: ['t1'], limit: 10 });
		expect(out).toEqual([{ id: 't2', hits: 3 }]);
	});
});
