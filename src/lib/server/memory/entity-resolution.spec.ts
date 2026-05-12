import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	canonicalKeyFromSurface,
	matchCanonicalEntitiesByEmbedding,
	resolveOrCreateCanonicalEntity
} from './entity-resolution';

const { createThoughtEmbeddingMock, getDbMock } = vi.hoisted(() => ({
	createThoughtEmbeddingMock: vi.fn(),
	getDbMock: vi.fn()
}));

vi.mock('$lib/server/llm/embedding', () => ({
	createThoughtEmbedding: createThoughtEmbeddingMock
}));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

const EMBEDDING_DIMENSIONS = 1536;
const fakeEmbedding = (): number[] => new Array(EMBEDDING_DIMENSIONS).fill(0.001);

type SelectResult = unknown[] | (() => unknown[]) | { throw: unknown };

/**
 * Each entry in `selects` provides the rows returned by the next `db.select(...)`
 * chain (whatever shape: `.where().limit()`, `.innerJoin().where().limit()`, or
 * `.where().orderBy().limit()`). Wrap with `{ throw: err }` to make that chain
 * throw instead.
 *
 * Each entry in `inserts` provides the value returned by the next
 * `db.insert().values().returning()` call (use `'void'` for inserts without `.returning()`).
 *
 * `executes` queues responses for raw `db.execute(sql\`...\`)` calls; each entry
 * is the `{ rows }` shape postgres-js returns, or `{ throw: err }`.
 */
function buildDb(config: {
	selects: SelectResult[];
	inserts?: Array<unknown[] | 'void'>;
	executes?: Array<{ rows: unknown[] } | { throw: unknown }>;
}) {
	let selectIdx = 0;
	let insertIdx = 0;
	let executeIdx = 0;
	const insertCalls: Array<{ values: Record<string, unknown> }> = [];

	const takeSelect = () => {
		const next = config.selects[selectIdx] ?? [];
		selectIdx += 1;
		if (next && typeof next === 'object' && !Array.isArray(next) && 'throw' in next) {
			throw next.throw;
		}
		return typeof next === 'function' ? next() : (next as unknown[]);
	};

	const chainableSelect = () => {
		const fromObj: Record<string, unknown> = {};
		const whereAware = {
			where: vi.fn(() => ({
				limit: vi.fn(async () => takeSelect()),
				orderBy: vi.fn(() => ({
					limit: vi.fn(async () => takeSelect())
				}))
			}))
		};
		Object.assign(fromObj, whereAware, {
			innerJoin: vi.fn(() => whereAware)
		});
		return {
			from: vi.fn(() => fromObj)
		};
	};

	return {
		select: vi.fn(() => chainableSelect()),
		insert: vi.fn(() => ({
			values: vi.fn((values: Record<string, unknown>) => {
				insertCalls.push({ values });
				const next = config.inserts?.[insertIdx];
				insertIdx += 1;
				if (next === 'void' || next === undefined) {
					return Promise.resolve();
				}
				return {
					returning: vi.fn(async () => next)
				};
			})
		})),
		update: vi.fn(() => ({
			set: vi.fn(() => ({
				where: vi.fn(async () => ({ rowCount: 1 }))
			}))
		})),
		execute: vi.fn(async () => {
			const next = config.executes?.[executeIdx] ?? { rows: [] };
			executeIdx += 1;
			if ('throw' in next) throw next.throw;
			return next;
		}),
		insertCalls
	};
}

describe('canonicalKeyFromSurface', () => {
	it('NFKC-folds, lowercases, and collapses whitespace', () => {
		expect(canonicalKeyFromSurface('  Sam   Smith  ')).toBe('sam smith');
	});
});

describe('resolveOrCreateCanonicalEntity', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns merged when canonical_key already matches', async () => {
		const db = buildDb({
			selects: [[{ id: 'e1', canonicalKey: 'sam', label: 'Sam' }]],
			inserts: ['void']
		});
		getDbMock.mockReturnValue(db);

		const out = await resolveOrCreateCanonicalEntity({
			userId: 'u1',
			thoughtId: 't1',
			surface: 'Sam',
			entityType: 'person',
			confidence: 0.9
		});

		expect(out).toEqual({ entityId: 'e1', canonicalKey: 'sam', decision: 'merged' });
		expect(createThoughtEmbeddingMock).not.toHaveBeenCalled();
		expect(db.insertCalls[0]?.values).toMatchObject({
			canonicalEntityId: 'e1',
			decision: 'merged',
			metadata: { reason: 'canonical_key_match' }
		});
	});

	it('returns merged when an alias matches the canonical key', async () => {
		const db = buildDb({
			selects: [
				[], // canonical key lookup empty
				[{ entityId: 'e2', canonicalKey: 'samuel' }] // alias lookup hits
			],
			inserts: ['void']
		});
		getDbMock.mockReturnValue(db);

		const out = await resolveOrCreateCanonicalEntity({
			userId: 'u1',
			thoughtId: 't1',
			surface: 'Sam',
			entityType: 'person',
			confidence: 0.5
		});

		expect(out).toEqual({ entityId: 'e2', canonicalKey: 'samuel', decision: 'merged' });
		expect(createThoughtEmbeddingMock).not.toHaveBeenCalled();
		expect(db.insertCalls[0]?.values).toMatchObject({
			canonicalEntityId: 'e2',
			decision: 'merged',
			metadata: { reason: 'alias_match' }
		});
	});

	it('merges into nearest embedding neighbor and inserts a new alias when below distance threshold', async () => {
		const db = buildDb({
			selects: [
				[], // canonical key
				[], // alias
				[
					{ id: 'e3', canonicalKey: 'samuel', label: 'Samuel', distance: 0.1 },
					{ id: 'e4', canonicalKey: 'sammy', label: 'Sammy', distance: 0.3 }
				],
				[] // aliasExists lookup empty → insert new alias
			],
			inserts: ['void', 'void']
		});
		getDbMock.mockReturnValue(db);
		createThoughtEmbeddingMock.mockResolvedValue(fakeEmbedding());

		const out = await resolveOrCreateCanonicalEntity({
			userId: 'u1',
			thoughtId: 't1',
			surface: 'Sam',
			entityType: 'person',
			confidence: 0.4
		});

		expect(out).toEqual({ entityId: 'e3', canonicalKey: 'samuel', decision: 'merged' });
		expect(db.insertCalls[0]?.values).toMatchObject({
			canonicalEntityId: 'e3',
			aliasText: 'sam'
		});
		expect(db.insertCalls[1]?.values).toMatchObject({
			canonicalEntityId: 'e3',
			decision: 'merged',
			metadata: { reason: 'embedding_neighbor', distance: 0.1 }
		});
	});

	it('does not insert duplicate alias when one already exists for the neighbor', async () => {
		const db = buildDb({
			selects: [
				[], // canonical key
				[], // alias
				[{ id: 'e3', canonicalKey: 'samuel', label: 'Samuel', distance: 0.1 }],
				[{ id: 'alias-existing' }] // aliasExists hits
			],
			inserts: ['void'] // only the resolution log insert
		});
		getDbMock.mockReturnValue(db);
		createThoughtEmbeddingMock.mockResolvedValue(fakeEmbedding());

		const out = await resolveOrCreateCanonicalEntity({
			userId: 'u1',
			thoughtId: 't1',
			surface: 'Sam',
			entityType: 'person',
			confidence: 0.4
		});

		expect(out.decision).toBe('merged');
		expect(db.insertCalls).toHaveLength(1);
		expect(db.insertCalls[0]?.values).toMatchObject({
			decision: 'merged',
			metadata: { reason: 'embedding_neighbor', distance: 0.1 }
		});
	});

	it('creates a fresh canonical entity, alias, and log when nothing matches', async () => {
		const db = buildDb({
			selects: [
				[], // canonical key
				[], // alias
				[{ id: 'e5', canonicalKey: 'somethingelse', label: 'Other', distance: 0.9 }]
				// no aliasExists query reached because nearest neighbor exceeds threshold
			],
			inserts: [[{ id: 'new-1', canonicalKey: 'fresh' }], 'void', 'void']
		});
		getDbMock.mockReturnValue(db);
		createThoughtEmbeddingMock.mockResolvedValue(fakeEmbedding());

		const out = await resolveOrCreateCanonicalEntity({
			userId: 'u1',
			thoughtId: 't1',
			surface: 'Fresh',
			entityType: 'topic',
			confidence: 1
		});

		expect(out).toEqual({ entityId: 'new-1', canonicalKey: 'fresh', decision: 'created' });
		expect(db.insertCalls[0]?.values).toMatchObject({
			canonicalKey: 'fresh',
			label: 'Fresh',
			entityType: 'topic'
		});
		expect(db.insertCalls[1]?.values).toMatchObject({
			canonicalEntityId: 'new-1',
			aliasText: 'fresh'
		});
		expect(db.insertCalls[2]?.values).toMatchObject({
			canonicalEntityId: 'new-1',
			decision: 'created',
			metadata: { entityType: 'topic' }
		});
	});

	it('treats empty neighbor list as a create path', async () => {
		const db = buildDb({
			selects: [[], [], []],
			inserts: [[{ id: 'new-2', canonicalKey: 'fresh' }], 'void', 'void']
		});
		getDbMock.mockReturnValue(db);
		createThoughtEmbeddingMock.mockResolvedValue(fakeEmbedding());

		const out = await resolveOrCreateCanonicalEntity({
			userId: 'u1',
			thoughtId: 't1',
			surface: 'Fresh',
			entityType: 'topic',
			confidence: 0.3
		});

		expect(out.decision).toBe('created');
	});

	it('throws when canonical entity insert returns no row', async () => {
		const db = buildDb({
			selects: [[], [], []],
			inserts: [[]]
		});
		getDbMock.mockReturnValue(db);
		createThoughtEmbeddingMock.mockResolvedValue(fakeEmbedding());

		await expect(
			resolveOrCreateCanonicalEntity({
				userId: 'u1',
				thoughtId: 't1',
				surface: 'Fresh',
				entityType: 'topic',
				confidence: 0.3
			})
		).rejects.toThrow(/insert returned no row/);
	});
});

describe('matchCanonicalEntitiesByEmbedding', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns nearest neighbors clamped to bounded limit', async () => {
		const db = buildDb({
			selects: [
				[
					{ id: 'e1', label: 'A', distance: 0.1 },
					{ id: 'e2', label: 'B', distance: 0.2 }
				]
			]
		});
		getDbMock.mockReturnValue(db);

		const out = await matchCanonicalEntitiesByEmbedding({
			userId: 'u1',
			embedding: fakeEmbedding(),
			limit: 100
		});

		expect(out).toEqual([
			{ id: 'e1', label: 'A', distance: 0.1 },
			{ id: 'e2', label: 'B', distance: 0.2 }
		]);
	});

	it('clamps limit floor to 1 and filters non-numeric distances', async () => {
		const db = buildDb({
			selects: [
				[
					{ id: 'e1', label: 'A', distance: 0.1 },
					{ id: 'e2', label: 'B', distance: 'oops' }
				]
			]
		});
		getDbMock.mockReturnValue(db);

		const out = await matchCanonicalEntitiesByEmbedding({
			userId: 'u1',
			embedding: fakeEmbedding(),
			limit: 0
		});

		expect(out).toEqual([{ id: 'e1', label: 'A', distance: 0.1 }]);
	});

	it('rejects embeddings with non-finite values', async () => {
		const bad = fakeEmbedding();
		bad[0] = Number.NaN;
		await expect(
			matchCanonicalEntitiesByEmbedding({ userId: 'u1', embedding: bad, limit: 5 })
		).rejects.toThrow(/finite numeric values/);
	});

	it('rejects embeddings with wrong dimensionality', async () => {
		await expect(
			matchCanonicalEntitiesByEmbedding({ userId: 'u1', embedding: [0.1, 0.2], limit: 5 })
		).rejects.toThrow(/Invalid embedding vector length/);
	});

	it('translates "missing relation" Postgres error into a migration-friendly message', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const pgError = Object.assign(new Error('relation does not exist'), { code: '42P01' });
		const db = buildDb({
			selects: [{ throw: pgError }],
			executes: [{ rows: [{ relname: null }] }]
		});
		getDbMock.mockReturnValue(db);

		await expect(
			matchCanonicalEntitiesByEmbedding({
				userId: 'u1',
				embedding: fakeEmbedding(),
				limit: 5
			})
		).rejects.toThrow(/Run database migrations/);
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	it('rethrows non-42P01 errors after logging diagnostics from existing relation', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const pgError = Object.assign(new Error('dimension mismatch'), {
			code: '22023',
			detail: 'd',
			hint: 'h',
			where: 'w'
		});
		const db = buildDb({
			selects: [{ throw: pgError }],
			executes: [
				{ rows: [{ relname: 'canonical_entity' }] },
				{
					rows: [
						{
							column_type: 'vector(1536)',
							stored_dims: 1536,
							non_null_embeddings: 7
						}
					]
				}
			]
		});
		getDbMock.mockReturnValue(db);

		await expect(
			matchCanonicalEntitiesByEmbedding({
				userId: 'u1',
				embedding: fakeEmbedding(),
				limit: 5
			})
		).rejects.toThrow(/dimension mismatch/);
		consoleSpy.mockRestore();
	});

	it('falls back to null diagnostic fields when the second execute returns an empty/sparse row', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const pgError = Object.assign(new Error('boom'), { code: 'XX000' });
		const db = buildDb({
			selects: [{ throw: pgError }],
			executes: [
				{ rows: [{ relname: 'canonical_entity' }] },
				{ rows: [] }
			]
		});
		getDbMock.mockReturnValue(db);

		await expect(
			matchCanonicalEntitiesByEmbedding({
				userId: 'u1',
				embedding: fakeEmbedding(),
				limit: 5
			})
		).rejects.toThrow(/boom/);
		const logged = consoleSpy.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
		expect(logged?.columnType).toBeNull();
		expect(logged?.storedDims).toBeNull();
		expect(logged?.nonNullEmbeddings).toBeNull();
		consoleSpy.mockRestore();
	});

	it('survives diagnostic execute failures and still rethrows the original error', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const pgError = Object.assign(new Error('boom'), { code: 'XX000' });
		const db = buildDb({
			selects: [{ throw: pgError }],
			executes: [{ throw: new Error('diagnostic query failed') }]
		});
		getDbMock.mockReturnValue(db);

		await expect(
			matchCanonicalEntitiesByEmbedding({
				userId: 'u1',
				embedding: fakeEmbedding(),
				limit: 5
			})
		).rejects.toThrow(/boom/);
		consoleSpy.mockRestore();
	});
});
