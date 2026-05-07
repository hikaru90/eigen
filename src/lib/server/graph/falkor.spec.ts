import { beforeEach, describe, expect, it, vi } from 'vitest';

const connectMock = vi.fn();
const queryMock = vi.fn();
const selectGraphMock = vi.fn(() => ({ query: queryMock }));
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

describe('upsertThoughtNode', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		env.FALKOR_HOST = '';
		env.FALKOR_PORT = '';
		env.FALKOR_GRAPH = '';
		connectMock.mockResolvedValue({ selectGraph: selectGraphMock });
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
});
