import { describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

const { getDbMock, loadEmbeddingSnapshotRowsMock, computeEmbeddingSnapshotRevisionMock, embeddingSnapshotMetaFromRowsMock } =
	vi.hoisted(() => ({
		getDbMock: vi.fn(() => ({})),
		loadEmbeddingSnapshotRowsMock: vi.fn(),
		computeEmbeddingSnapshotRevisionMock: vi.fn(),
		embeddingSnapshotMetaFromRowsMock: vi.fn()
	}));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

vi.mock('$lib/server/embeddings/embedding-snapshot', () => ({
	computeEmbeddingSnapshotRevision: computeEmbeddingSnapshotRevisionMock,
	embeddingSnapshotMetaFromRows: embeddingSnapshotMetaFromRowsMock,
	loadEmbeddingSnapshotRows: loadEmbeddingSnapshotRowsMock
}));

function event(user: { id: string } | null = { id: 'u1' }) {
	return { locals: { user } } as Parameters<typeof GET>[0];
}

describe('GET /api/embeddings/revision', () => {
	it('returns 401 when unauthenticated', async () => {
		await expect(GET(event(null))).rejects.toMatchObject({ status: 401 });
	});

	it('returns the computed revision hash', async () => {
		const rows = [{ id: 't1', kind: 'Thought' as const, updatedAt: new Date('2026-01-01') }];
		loadEmbeddingSnapshotRowsMock.mockResolvedValue(rows);
		embeddingSnapshotMetaFromRowsMock.mockReturnValue(rows);
		computeEmbeddingSnapshotRevisionMock.mockReturnValue('rev-hash');

		const res = await GET(event());
		expect(loadEmbeddingSnapshotRowsMock).toHaveBeenCalledWith(expect.anything(), 'u1');
		expect(computeEmbeddingSnapshotRevisionMock).toHaveBeenCalledWith(rows);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ revision: 'rev-hash' });
	});
});
