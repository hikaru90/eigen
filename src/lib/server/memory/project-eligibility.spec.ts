import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
	demoteProject,
	ensureProject,
	pickHigherProjectSource,
	restoreProjectListing
} from './project-eligibility';

const { getDbMock, updateSetMock, updateWhereMock, selectLimitMock } = vi.hoisted(() => {
	const updateWhereMock = vi.fn();
	return {
		getDbMock: vi.fn(),
		updateSetMock: vi.fn(() => ({ where: updateWhereMock })),
		updateWhereMock,
		selectLimitMock: vi.fn()
	};
});

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

vi.mock('$lib/server/graph/age', () => ({
	upsertEntityNode: vi.fn(async () => undefined)
}));

describe('project-eligibility', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: selectLimitMock
					}))
				}))
			})),
			update: vi.fn(() => ({
				set: updateSetMock
			}))
		});
	});

	it('pickHigherProjectSource never downgrades manual provenance', () => {
		expect(pickHigherProjectSource('manual', 'capture')).toBe('manual');
		expect(pickHigherProjectSource('grounding', 'capture')).toBe('grounding');
		expect(pickHigherProjectSource('capture', 'manual')).toBe('manual');
	});

	it('demoteProject is a no-op for manual projects', async () => {
		selectLimitMock.mockResolvedValueOnce([
			{
				id: 'p1',
				label: 'Hydra',
				canonicalKey: 'hydra',
				entityType: 'project',
				projectStatus: 'active',
				projectSource: 'manual'
			}
		]);

		const didDemote = await demoteProject('u1', 'p1');
		expect(didDemote).toBe(false);
		expect(updateSetMock).not.toHaveBeenCalled();
	});

	it('ensureProject keeps manual source when capture path re-upserts', async () => {
		selectLimitMock.mockResolvedValueOnce([
			{
				id: 'p1',
				label: 'Hydra',
				canonicalKey: 'hydra',
				entityType: 'project',
				projectStatus: 'active',
				projectSource: 'manual'
			}
		]);

		await ensureProject('u1', 'p1', 'active', 'capture');
		expect(updateSetMock).toHaveBeenCalled();
		const setArg = updateSetMock.mock.calls[0]?.[0];
		expect(setArg?.projectSource).toBe('manual');
	});

	it('restoreProjectListing re-lists a demoted capture project', async () => {
		selectLimitMock.mockResolvedValueOnce([
			{
				id: 'p1',
				label: 'Eigen',
				canonicalKey: 'eigen',
				entityType: 'organization',
				projectStatus: null,
				projectSource: null
			}
		]);

		await restoreProjectListing('u1', 'p1', 'active', 'capture');
		expect(updateSetMock).toHaveBeenCalled();
		const setArg = updateSetMock.mock.calls[0]?.[0];
		expect(setArg?.projectStatus).toBe('active');
		expect(setArg?.entityType).toBe('project');
	});
});
