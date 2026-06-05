import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDbMock } = vi.hoisted(() => ({
	getDbMock: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

import { runSalienceCompute } from './compute-salience';

describe('runSalienceCompute', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns decay and open-loop counts', async () => {
		const decayReturning = vi.fn(async () => [{ id: 't1' }]);
		const openReturning = vi.fn(async () => [{ id: 't2' }, { id: 't3' }]);
		const decayWhere = vi.fn(() => ({ returning: decayReturning }));
		const openWhere = vi.fn(() => ({ returning: openReturning }));
		const decaySet = vi.fn(() => ({ where: decayWhere }));
		const openSet = vi.fn(() => ({ where: openWhere }));
		const update = vi
			.fn()
			.mockImplementationOnce(() => ({ set: decaySet }))
			.mockImplementationOnce(() => ({ set: openSet }));

		getDbMock.mockReturnValue({ update });

		await expect(runSalienceCompute('u1')).resolves.toEqual({ decayed: 1, openLoops: 2 });
		expect(update).toHaveBeenCalledTimes(2);
	});

	it('open-loop update filters on metadata.status not resolvedAt', () => {
		const source = runSalienceCompute.toString();
		expect(source).toContain("metadata}->>'status'");
		expect(source).not.toContain("resolvedAt");
	});
});
