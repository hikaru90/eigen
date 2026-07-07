import { describe, expect, it, vi } from 'vitest';
import { listProjectsForUser } from './project-list';

vi.mock('$lib/server/memory/judge-gtd-project', () => ({
	auditGtdProjectProfiles: vi.fn(async () => ({ demoted: 0 }))
}));

const selectMock = vi.fn();

vi.mock('$lib/server/db', () => ({
	getDb: () => ({
		select: selectMock
	})
}));

vi.mock('$lib/server/memory/project-eligibility', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./project-eligibility')>();
	return {
		...actual,
		countOpenTasksForProjectEntity: vi.fn(async () => 0)
	};
});

describe('listProjectsForUser', () => {
	it('does not run audit on read', async () => {
		const chain = {
			from: vi.fn(() => ({
				where: vi.fn(async () => [])
			}))
		};
		selectMock.mockReturnValue(chain);

		await listProjectsForUser('u1');

		const { auditGtdProjectProfiles } = await import('$lib/server/memory/judge-gtd-project');
		expect(auditGtdProjectProfiles).not.toHaveBeenCalled();
	});
});
