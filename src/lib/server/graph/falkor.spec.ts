import { beforeEach, describe, expect, it, vi } from 'vitest';

const connectMock = vi.fn();
const queryMock = vi.fn();
const selectGraphMock = vi.fn(() => ({ query: queryMock }));
const getDbMock = vi.fn(() => ({}));
const logActivityCallMock = vi.fn();
const env = {
	FALKOR_HOST: '',
	FALKOR_PORT: '',
	FALKOR_GRAPH: '',
	FALKOR_PASSWORD: '',
	FALKOR_USERNAME: ''
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
		env.FALKOR_HOST = 'localhost';
		env.FALKOR_PORT = '6379';
		env.FALKOR_GRAPH = '';
		env.FALKOR_PASSWORD = 'secret';
		env.FALKOR_USERNAME = 'default';
		connectMock.mockResolvedValue({ selectGraph: selectGraphMock });
		queryMock.mockResolvedValue({ data: [] });
	});

	it('uses explicit Falkor env and sends expected query params', async () => {
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
			socket: { host: 'localhost', port: 6379 },
			password: 'secret',
			username: 'default'
		});
		expect(selectGraphMock).toHaveBeenCalledWith('user_u1');
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

	it('throws when required Falkor env is missing', async () => {
		vi.resetModules();
		env.FALKOR_HOST = '';
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
		).rejects.toThrow(/FALKOR_HOST is required/);
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
		queryMock.mockResolvedValueOnce({ data: [{ id: 't2', hits: 3 }] });
		const { expandNeighborsByIds } = await import('./falkor');
		const out = await expandNeighborsByIds({ userId: 'u1', seedIds: ['t1'], limit: 10 });
		expect(out).toEqual([{ id: 't2', hits: 3 }]);
	});

	it('runs graph-only query search with tokenized input', async () => {
		queryMock.mockResolvedValueOnce({ data: [{ id: 't2', score: 4 }] });
		const { graphOnlySearchByQuery } = await import('./falkor');
		const out = await graphOnlySearchByQuery({
			userId: 'u1',
			query: 'How does sleep affect training?',
			limit: 10
		});
		expect(queryMock).toHaveBeenCalledWith(
			expect.stringContaining('MATCH (t:Thought {user_id: $user_id})'),
			expect.objectContaining({
				params: expect.objectContaining({
					user_id: 'u1',
					limit: 10
				})
			})
		);
		expect(out).toEqual([{ id: 't2', score: 4 }]);
	});

	it('fetches visualization snapshot from Thought, Entity, and edge queries', async () => {
		queryMock
			.mockResolvedValueOnce({
				data: [{ id: 't1', label: 'hello', subtype: 'thought' }]
			})
			.mockResolvedValueOnce({
				data: [{ id: 'e1', label: 'Alice', subtype: 'person' }]
			})
			.mockResolvedValueOnce({
				data: [{ source_id: 't1', target_id: 't2', rel_type: 'related_to' }]
			})
			.mockResolvedValueOnce({
				data: [{ source_id: 't1', target_id: 'e1', rel_type: 'mentions' }]
			})
			.mockResolvedValueOnce({
				data: [{ source_id: 'e1', target_id: 'e2', rel_type: 'knows' }]
			});

		const { fetchGraphVisualizationSnapshot } = await import('./falkor');
		const snap = await fetchGraphVisualizationSnapshot({ userId: 'u1', nodeLimit: 10, edgeLimit: 10 });

		expect(snap.nodes.map((n) => n.id).sort()).toEqual(['e1', 't1']);
		expect(snap.edges.length).toBe(3);
		expect(queryMock).toHaveBeenCalledTimes(5);
	});

	it('passes FALKOR_USERNAME when set alongside password', async () => {
		vi.resetModules();
		vi.clearAllMocks();
		env.FALKOR_HOST = 'localhost';
		env.FALKOR_PORT = '6379';
		env.FALKOR_GRAPH = '';
		env.FALKOR_PASSWORD = 'secret';
		env.FALKOR_USERNAME = 'customuser';
		connectMock.mockResolvedValue({ selectGraph: selectGraphMock });
		queryMock.mockResolvedValue({ data: [] });

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
			socket: { host: 'localhost', port: 6379 },
			password: 'secret',
			username: 'customuser'
		});
	});

	it('upsertEntityNode merges Entity node and forwards canonical metadata', async () => {
		const { upsertEntityNode } = await import('./falkor');
		await upsertEntityNode({
			id: 'e1',
			userId: 'u1',
			canonicalKey: 'sam',
			label: 'Sam',
			entityType: 'person'
		});
		expect(queryMock).toHaveBeenCalledWith(
			expect.stringContaining('MERGE (e:Entity {id: $id})'),
			expect.objectContaining({
				params: expect.objectContaining({
					id: 'e1',
					user_id: 'u1',
					canonical_key: 'sam',
					label: 'Sam',
					entity_type: 'person'
				})
			})
		);
	});

	it('upsertMentionEdge merges MENTIONS edge between Thought and Entity', async () => {
		const { upsertMentionEdge } = await import('./falkor');
		await upsertMentionEdge({ userId: 'u1', thoughtId: 't1', entityId: 'e1' });
		expect(queryMock).toHaveBeenCalledWith(
			expect.stringContaining('MERGE (t)-[r:MENTIONS'),
			expect.objectContaining({
				params: expect.objectContaining({
					thought_id: 't1',
					entity_id: 'e1',
					user_id: 'u1'
				})
			})
		);
	});

	it('upsertEntityRelationEdge merges ENTITY_RELATES with predicate', async () => {
		const { upsertEntityRelationEdge } = await import('./falkor');
		await upsertEntityRelationEdge({
			userId: 'u1',
			sourceEntityId: 'e1',
			targetEntityId: 'e2',
			predicate: 'located_in'
		});
		expect(queryMock).toHaveBeenCalledWith(
			expect.stringContaining('MERGE (a)-[r:ENTITY_RELATES'),
			expect.objectContaining({
				params: expect.objectContaining({
					a_id: 'e1',
					b_id: 'e2',
					user_id: 'u1',
					predicate: 'located_in'
				})
			})
		);
	});

	it('expandThoughtIdsFromEntitySeeds short-circuits with empty array when no ids given', async () => {
		const { expandThoughtIdsFromEntitySeeds } = await import('./falkor');
		const out = await expandThoughtIdsFromEntitySeeds({
			userId: 'u1',
			entityIds: [],
			limit: 10
		});
		expect(out).toEqual([]);
		expect(queryMock).not.toHaveBeenCalled();
	});

	it('expandThoughtIdsFromEntitySeeds merges direct and one-hop hits and tags provenance', async () => {
		queryMock
			.mockResolvedValueOnce({
				data: [
					{ id: 't1', hits: 2, via_label: 'Sam' },
					{ id: 't2', hits: 1, via_label: '' }
				]
			})
			.mockResolvedValueOnce({
				data: [{ id: 't2', hits: 3, via_label: 'Berlin' }]
			});
		const { expandThoughtIdsFromEntitySeeds } = await import('./falkor');
		const out = await expandThoughtIdsFromEntitySeeds({
			userId: 'u1',
			entityIds: ['e1', 'e1'],
			limit: 10
		});
		const t2 = out.find((r) => r.id === 't2');
		const t1 = out.find((r) => r.id === 't1');
		expect(t2).toEqual({ id: 't2', hits: 4, provenance: 'via_related:Berlin' });
		expect(t1).toEqual({ id: 't1', hits: 2, provenance: 'entity:Sam' });
		expect(out[0].hits).toBeGreaterThanOrEqual(out[out.length - 1].hits);
	});

	it('normalizes user id into graph-safe graph name', async () => {
		vi.resetModules();
		vi.clearAllMocks();
		env.FALKOR_HOST = 'localhost';
		env.FALKOR_PORT = '6379';
		env.FALKOR_GRAPH = 'eigen_memory';
		env.FALKOR_PASSWORD = 'secret';
		env.FALKOR_USERNAME = 'default';
		connectMock.mockResolvedValue({ selectGraph: selectGraphMock });
		queryMock.mockResolvedValue({ data: [] });

		const { upsertThoughtNode } = await import('./falkor');
		await upsertThoughtNode({
			id: 't1',
			userId: 'User-ID.With Spaces',
			rawText: 'raw',
			normalizedText: 'normalized',
			lexicalText: 'lexical',
			category: 'thought'
		});

		expect(selectGraphMock).toHaveBeenCalledWith('user_user_id_with_spaces');
	});
});
