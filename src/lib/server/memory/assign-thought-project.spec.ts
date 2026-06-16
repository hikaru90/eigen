import { describe, expect, it, vi } from 'vitest';
import { assignThoughtToProject } from './assign-thought-project';

const { getDbMock, linkThoughtToProjectMock, upsertProjectEntityMock } = vi.hoisted(() => ({
	getDbMock: vi.fn(),
	linkThoughtToProjectMock: vi.fn(async () => undefined),
	upsertProjectEntityMock: vi.fn(async () => 'new-project-id')
}));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

vi.mock('$lib/server/memory/project-next-action', () => ({
	linkThoughtToProject: linkThoughtToProjectMock
}));

vi.mock('$lib/server/memory/project-entity', () => ({
	upsertProjectEntity: upsertProjectEntityMock
}));

function makeAwaitableChain(rows: unknown[]) {
	const chain = {
		from: vi.fn(() => chain),
		where: vi.fn(() => chain),
		limit: vi.fn(async () => rows),
		then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
			return Promise.resolve(rows).then(onFulfilled, onRejected);
		}
	};
	return chain;
}

describe('assignThoughtToProject', () => {
	it('links thought to existing project entity', async () => {
		getDbMock.mockReturnValue({
			select: vi.fn().mockReturnValue(
				makeAwaitableChain([
					{ id: 'p1', label: 'Website', entityType: 'project' }
				])
			)
		});

		const result = await assignThoughtToProject('u1', 't1', { projectEntityId: 'p1' });
		expect(result).toEqual({ projectEntityId: 'p1', projectLabel: 'Website' });
		expect(linkThoughtToProjectMock).toHaveBeenCalledWith('u1', 'p1', 't1');
		expect(upsertProjectEntityMock).not.toHaveBeenCalled();
	});

	it('creates project from label when no entity id', async () => {
		upsertProjectEntityMock.mockResolvedValueOnce('p-new');

		const result = await assignThoughtToProject('u1', 't1', { projectLabel: 'New project' });
		expect(result).toEqual({ projectEntityId: 'p-new', projectLabel: 'New project' });
		expect(upsertProjectEntityMock).toHaveBeenCalledWith('u1', 'New project');
		expect(linkThoughtToProjectMock).toHaveBeenCalledWith('u1', 'p-new', 't1');
	});
});
