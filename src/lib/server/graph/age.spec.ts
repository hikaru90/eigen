import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	expandNeighborsByIds,
	graphOnlySearchByQuery,
	thoughtExistsInGraph,
	upsertEntityNode,
	upsertEventNode,
	upsertMentionEdge,
	upsertThoughtNode,
	upsertThoughtRelation
} from './age';

const ageSourcePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'age.ts');

const { executeMock, getDbMock, logActivityCallMock } = vi.hoisted(() => ({
	executeMock: vi.fn(),
	getDbMock: vi.fn(),
	logActivityCallMock: vi.fn()
}));

getDbMock.mockImplementation(() => ({ execute: executeMock }));

const { env } = vi.hoisted(() => ({
	env: { AGE_GRAPH_NAME: 'eigen_graph' }
}));

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
		.mockResolvedValueOnce({ rows });
}

function sqlTextFromExecuteArg(arg: unknown): string {
	if (typeof arg === 'string') return arg;
	if (arg && typeof arg === 'object') {
		const record = arg as { queryChunks?: Array<{ value?: string[] }> };
		if (Array.isArray(record.queryChunks)) {
			return record.queryChunks
				.flatMap((chunk) => chunk.value ?? [])
				.join('');
		}
	}
	return String(arg);
}

function latestCypherCallSql(): string {
	const cypherCalls = executeMock.mock.calls
		.map((call) => sqlTextFromExecuteArg(call[0]))
		.filter((text) => text.includes('ag_catalog.cypher'));
	return cypherCalls.at(-1) ?? '';
}

describe('graph adapter (Apache AGE)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		env.AGE_GRAPH_NAME = 'eigen_graph';
		executeMock.mockImplementation(async () => ({ rows: [] }));
	});

	it('throws when AGE_GRAPH_NAME is missing', async () => {
		env.AGE_GRAPH_NAME = '';
		await expect(
			upsertThoughtNode({ id: 't1', userId: 'u1', category: 'thought' })
		).rejects.toThrow(/AGE_GRAPH_NAME is required/);
		env.AGE_GRAPH_NAME = 'eigen_graph';
	});

	it('upsertThoughtNode runs through AGE and logs activity', async () => {
		mockCypherRows([{ id: 't1' }]);
		await upsertThoughtNode({ id: 't1', userId: 'u1', category: 'thought' });
		expect(executeMock).toHaveBeenCalledTimes(2);
		expect(logActivityCallMock).toHaveBeenCalledWith(
			expect.anything(),
			'u1',
			expect.objectContaining({ provider: 'apache_age' })
		);
	});

	it('tenant-keyed MERGE patterns include user_id in node identity for upsert writes', async () => {
		mockCypherRows([{ id: 't1' }]);
		await upsertThoughtNode({ id: 't1', userId: 'u1', category: 'thought' });
		expect(latestCypherCallSql()).toMatch(
			/MERGE \(t:Thought \{id: 't1', user_id: 'u1'\}\)/
		);

		mockCypherRows([{ id: 'e1' }]);
		await upsertEntityNode({
			id: 'e1',
			userId: 'u1',
			canonicalKey: 'acme',
			label: 'Acme',
			entityType: 'organization'
		});
		expect(latestCypherCallSql()).toMatch(
			/MERGE \(e:Entity \{id: 'e1', user_id: 'u1'\}\)/
		);

		mockCypherRows([{ id: 'ev1' }]);
		await upsertEventNode({
			id: 'ev1',
			userId: 'u1',
			kind: 'meeting',
			label: 'Standup',
			startAt: '2026-01-01T09:00:00Z',
			endAt: '2026-01-01T09:30:00Z'
		});
		expect(latestCypherCallSql()).toMatch(
			/MERGE \(e:Event \{id: 'ev1', user_id: 'u1'\}\)/
		);

		mockCypherRows([{ ok: 1 }]);
		await upsertMentionEdge({ userId: 'u1', thoughtId: 't1', entityId: 'e1' });
		const mentionSql = latestCypherCallSql();
		expect(mentionSql).toMatch(/MERGE \(t:Thought \{id: 't1', user_id: 'u1'\}\)/);
		expect(mentionSql).toMatch(/MERGE \(e:Entity \{id: 'e1', user_id: 'u1'\}\)/);

		mockCypherRows([{ ok: 1 }]);
		await upsertThoughtRelation({
			userId: 'u1',
			sourceId: 't1',
			targetId: 't2',
			relationType: 'supports'
		});
		const relationSql = latestCypherCallSql();
		expect(relationSql).toMatch(/MATCH \(a:Thought \{id: 't1', user_id: 'u1'\}\)/);
		expect(relationSql).toMatch(/MATCH \(b:Thought \{id: 't2', user_id: 'u1'\}\)/);
	});

	it('every Thought/Entity/Event MERGE or MATCH in age.ts includes user_id in the node map', () => {
		const source = readFileSync(ageSourcePath, 'utf-8');
		const nodePattern = /(?:MERGE|MATCH)\s*\([^)]*:(Thought|Entity|Event)\s*\{([^}]*)\}/g;
		const matches = [...source.matchAll(nodePattern)];
		expect(matches.length).toBeGreaterThan(0);
		for (const match of matches) {
			expect(match[2], `Missing user_id in node pattern: ${match[0]}`).toMatch(/user_id/);
		}
	});

	it('expandNeighborsByIds returns ranked thought hits', async () => {
		mockCypherRows([{ id: 't2', hits: 3 }]);
		const out = await expandNeighborsByIds({ userId: 'u1', seedIds: ['t1'], limit: 10 });
		expect(out).toEqual([{ id: 't2', hits: 3, provenance: 'via_related:thought_link' }]);
	});

	it('graphOnlySearchByQuery short-circuits when query tokenization is empty', async () => {
		const out = await graphOnlySearchByQuery({ userId: 'u1', query: '!', limit: 10 });
		expect(out).toEqual([]);
		expect(executeMock).not.toHaveBeenCalled();
	});

	it('thoughtExistsInGraph returns true only when rows are returned', async () => {
		mockCypherRows([{ id: 't1' }]);
		await expect(thoughtExistsInGraph('u1', 't1')).resolves.toBe(true);

		mockCypherRows([]);
		await expect(thoughtExistsInGraph('u1', 't2')).resolves.toBe(false);
	});
});
