import { beforeEach, describe, expect, it, vi } from 'vitest';
import { promoteEntityToProject } from './maybe-promote-gtd-project';

const {
	getDbMock,
	loadCtxMock,
	shouldJudgeMock,
	judgeMock,
	promoteTypeMock,
	ensureMock
} = vi.hoisted(() => ({
	getDbMock: vi.fn(),
	loadCtxMock: vi.fn(),
	shouldJudgeMock: vi.fn(),
	judgeMock: vi.fn(),
	promoteTypeMock: vi.fn(),
	ensureMock: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

vi.mock('$lib/server/memory/judge-gtd-project', () => ({
	loadHubJudgmentContext: loadCtxMock,
	shouldInvokeGtdProjectJudge: shouldJudgeMock,
	judgeGtdProjectHub: judgeMock
}));

vi.mock('$lib/server/memory/project-eligibility', () => ({
	ensureProject: ensureMock
}));

vi.mock('$lib/server/memory/project-entity', () => ({
	promoteHubEntityType: promoteTypeMock
}));

describe('promoteEntityToProject', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		const limit = vi.fn(async () => []);
		const where = vi.fn(() => ({ limit }));
		const from = vi.fn(() => ({ where }));
		const select = vi.fn(() => ({ from }));
		getDbMock.mockReturnValue({ select });
		loadCtxMock.mockResolvedValue({ linkedThoughtCount: 3, openTaskCount: 1 });
		shouldJudgeMock.mockReturnValue(true);
		judgeMock.mockResolvedValue({ isGtdProject: true, canonicalLabel: 'Eigen' });
		promoteTypeMock.mockResolvedValue(undefined);
		ensureMock.mockResolvedValue(undefined);
	});

	it('returns true when entity already has projectStatus', async () => {
		const limit = vi.fn(async () => [{ id: 'e1' }]);
		const where = vi.fn(() => ({ limit }));
		const from = vi.fn(() => ({ where }));
		const select = vi.fn(() => ({ from }));
		getDbMock.mockReturnValue({ select });
		await expect(
			promoteEntityToProject({ userId: 'u1', entityId: 'e1' })
		).resolves.toBe(true);
		expect(judgeMock).not.toHaveBeenCalled();
	});

	it('returns false when judgment context is missing', async () => {
		loadCtxMock.mockResolvedValue(null);
		await expect(
			promoteEntityToProject({ userId: 'u1', entityId: 'e1' })
		).resolves.toBe(false);
	});

	it('returns false when judge should not run', async () => {
		shouldJudgeMock.mockReturnValue(false);
		await expect(
			promoteEntityToProject({ userId: 'u1', entityId: 'e1' })
		).resolves.toBe(false);
	});

	it('promotes when LLM judge approves', async () => {
		await expect(
			promoteEntityToProject({ userId: 'u1', entityId: 'e1', forceJudge: true })
		).resolves.toBe(true);
		expect(promoteTypeMock).toHaveBeenCalledWith('u1', 'e1', 'Eigen');
		expect(ensureMock).toHaveBeenCalled();
	});

	it('returns false when judge rejects', async () => {
		judgeMock.mockResolvedValue({ isGtdProject: false });
		await expect(
			promoteEntityToProject({ userId: 'u1', entityId: 'e1' })
		).resolves.toBe(false);
	});
});
