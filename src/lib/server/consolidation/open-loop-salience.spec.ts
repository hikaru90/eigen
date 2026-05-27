import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDbMock } = vi.hoisted(() => ({
	getDbMock: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

import { boostOpenLoopSalience } from './open-loop-salience';

describe('boostOpenLoopSalience', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns count of updated open_loop rows', async () => {
		const returning = vi.fn(async () => [{ id: 't1' }, { id: 't2' }]);
		const where = vi.fn(() => ({ returning }));
		const set = vi.fn(() => ({ where }));
		const update = vi.fn(() => ({ set }));

		getDbMock.mockReturnValue({ update });

		await expect(boostOpenLoopSalience('u1')).resolves.toBe(2);
		expect(update).toHaveBeenCalled();
	});
});
