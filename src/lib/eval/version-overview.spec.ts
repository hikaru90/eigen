import { beforeEach, describe, expect, it, vi } from 'vitest';

const { withDbUserMock, listEvalQaMock, loadEvalRunDetailMock, appVersion } = vi.hoisted(() => ({
	withDbUserMock: vi.fn(),
	listEvalQaMock: vi.fn(),
	loadEvalRunDetailMock: vi.fn(),
	appVersion: '9.9.9'
}));

vi.mock('$lib/app-version', () => ({
	APP_VERSION: appVersion
}));

vi.mock('$lib/server/db', () => ({
	withDbUser: withDbUserMock
}));

vi.mock('./qa-store', () => ({
	listEvalQa: listEvalQaMock
}));

vi.mock('./store', () => ({
	loadEvalRunDetail: loadEvalRunDetailMock
}));

import { loadVersionEvalOverview } from './version-overview';

describe('loadVersionEvalOverview', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		listEvalQaMock.mockResolvedValue([
			{ id: 'qa_smoke_dinner', question: 'What did we have for dinner?', tags: [] }
		]);
		loadEvalRunDetailMock.mockResolvedValue(null);
	});

	it('only considers eval runs stamped with the current app version', async () => {
		const execute = vi.fn().mockResolvedValue({ rows: [] });
		withDbUserMock.mockImplementation(async (_userId: string, fn: (db: { execute: typeof execute }) => unknown) =>
			fn({ execute })
		);

		const overview = await loadVersionEvalOverview('operator-1');

		expect(overview.version).toBe('9.9.9');
		expect(overview.tests[0]?.runId).toBeNull();
		expect(overview.tests[0]?.runStatus).toBeNull();
		expect(execute).toHaveBeenCalledOnce();
	});
});
