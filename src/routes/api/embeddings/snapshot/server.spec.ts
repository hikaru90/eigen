import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET } from './+server';

/**
 * Builds a mock 1536-element embedding array.
 */
function makeEmbedding(): number[] {
	return Array.from({ length: 1536 }, (_, i) => i * 0.001);
}

const { getDbMock } = vi.hoisted(() => ({
	getDbMock: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

beforeEach(() => {
	getDbMock.mockReset();
});

/**
 * Build a full Drizzle-like select chain that resolves to `rows`.
 * The endpoint calls: db.select({...}).from(...).where(...).orderBy(...).limit(n)
 * getDb() is called once; db.select() is called twice (thoughts, then entities).
 */
function makeDbWithRows(thoughtRows: unknown[], entityRows: unknown[]) {
	function chain(rows: unknown[]) {
		const limit = vi.fn(async () => rows);
		const orderBy = vi.fn(() => ({ limit }));
		const where = vi.fn(() => ({ orderBy }));
		const from = vi.fn(() => ({ where }));
		return { from };
	}

	let selectCall = 0;
	const select = vi.fn(() => {
		selectCall++;
		if (selectCall === 1) return chain(thoughtRows);
		return chain(entityRows);
	});

	getDbMock.mockReturnValue({ select });
}

describe('GET /api/embeddings/snapshot', () => {
	it('returns 401 for unauthenticated requests', async () => {
		await expect(GET({ locals: { user: null } } as never)).rejects.toMatchObject({
			status: 401
		});
	});

	it('returns thoughts and entities with embeddings', async () => {
		const thoughtRow = {
			id: 't1',
			rawText: 'Hello world',
			category: 'observation',
			embedding: makeEmbedding(),
			updatedAt: new Date('2026-01-01T00:00:00.000Z')
		};
		const entityRow = {
			id: 'e1',
			label: 'Alice',
			entityType: 'person',
			embedding: makeEmbedding(),
			updatedAt: new Date('2026-01-02T00:00:00.000Z')
		};

		makeDbWithRows([thoughtRow], [entityRow]);

		const res = await GET({ locals: { user: { id: 'u1' } } } as never);
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.items).toHaveLength(2);
		expect(typeof body.revision).toBe('string');
		expect(body.revision.length).toBeGreaterThan(0);

		const t = body.items.find((i: { id: string }) => i.id === 't1');
		expect(t).toMatchObject({ kind: 'Thought', subtype: 'observation' });
		expect(t.embedding).toHaveLength(1536);

		const e = body.items.find((i: { id: string }) => i.id === 'e1');
		expect(e).toMatchObject({ kind: 'Entity', subtype: 'person', label: 'Alice' });
		expect(e.embedding).toHaveLength(1536);
	});

	it('hard-errors (500) when an embedding has wrong length', async () => {
		const badRow = {
			id: 'bad',
			rawText: 'corrupt',
			category: 'task',
			embedding: [1, 2, 3],
			updatedAt: new Date('2026-01-01T00:00:00.000Z')
		};

		makeDbWithRows([badRow], []);

		await expect(GET({ locals: { user: { id: 'u1' } } } as never)).rejects.toMatchObject({
			status: 500
		});
	});

	it('returns an empty items array when no embeddings exist', async () => {
		makeDbWithRows([], []);

		const res = await GET({ locals: { user: { id: 'u1' } } } as never);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.items).toHaveLength(0);
	});

	it('caps total items at 800 (entities fill remaining capacity after thoughts)', async () => {
		// 800 thought rows — fills the cap exactly; entity rows should be excluded
		const thoughtRows = Array.from({ length: 800 }, (_, i) => ({
			id: `t${i}`,
			rawText: `thought ${i}`,
			category: 'observation',
			embedding: makeEmbedding(),
			updatedAt: new Date('2026-01-01T00:00:00.000Z')
		}));
		const entityRows = Array.from({ length: 50 }, (_, i) => ({
			id: `e${i}`,
			label: `entity ${i}`,
			entityType: 'other',
			embedding: makeEmbedding(),
			updatedAt: new Date('2026-01-02T00:00:00.000Z')
		}));

		makeDbWithRows(thoughtRows, entityRows);

		const res = await GET({ locals: { user: { id: 'u1' } } } as never);
		expect(res.status).toBe(200);
		const body = await res.json();
		// 800 thoughts + 0 entities (remaining capacity = 0)
		expect(body.items).toHaveLength(800);
		expect(body.items.every((i: { kind: string }) => i.kind === 'Thought')).toBe(true);
	});
});
