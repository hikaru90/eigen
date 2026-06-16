import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearNextActionIfCompleted, designateNextAction } from './project-next-action';

const { getDbMock, upsertMentionEdgeMock, ensureProjectProfileMock } = vi.hoisted(() => ({
	getDbMock: vi.fn(),
	upsertMentionEdgeMock: vi.fn(async () => undefined),
	ensureProjectProfileMock: vi.fn(async () => undefined)
}));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

vi.mock('$lib/server/graph/age', () => ({
	upsertMentionEdge: upsertMentionEdgeMock
}));

vi.mock('$lib/server/memory/project-list', () => ({
	ensureProjectProfile: ensureProjectProfileMock
}));

function makeLimitChain(rows: unknown[]) {
	const chain = {
		from: vi.fn(() => chain),
		where: vi.fn(() => chain),
		limit: vi.fn(async () => rows)
	};
	return chain;
}

describe('project-next-action', () => {
	beforeEach(() => vi.clearAllMocks());

	it('designateNextAction links thought to project', async () => {
		getDbMock.mockReturnValue({
			select: vi.fn().mockReturnValue(makeLimitChain([{ id: 'project-1' }])),
			insert: vi.fn(() => ({
				values: vi.fn(() => ({
					onConflictDoNothing: vi.fn(async () => undefined),
					onConflictDoUpdate: vi.fn(async () => undefined)
				}))
			}))
		});

		await designateNextAction('u1', 'project-1', 'thought-1');
		expect(ensureProjectProfileMock).toHaveBeenCalledWith('u1', 'project-1', 'active');
		expect(upsertMentionEdgeMock).toHaveBeenCalledWith({
			userId: 'u1',
			thoughtId: 'thought-1',
			entityId: 'project-1'
		});
	});

	it('clearNextActionIfCompleted clears matching profile row', async () => {
		const whereMock = vi.fn(async () => undefined);
		getDbMock.mockReturnValue({
			update: vi.fn(() => ({
				set: vi.fn(() => ({ where: whereMock }))
			}))
		});

		await clearNextActionIfCompleted('u1', 'thought-1');
		expect(whereMock).toHaveBeenCalled();
	});
});
