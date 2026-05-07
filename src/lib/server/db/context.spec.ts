import { describe, expect, it } from 'vitest';
import { appDbAsyncLocal, getDb } from './context';

describe('db context', () => {
	it('throws when context is missing', () => {
		expect(() => getDb()).toThrow(/outside an active request/);
	});

	it('returns db from async local storage', async () => {
		const fakeDb = { marker: 'db' };
		await appDbAsyncLocal.run(fakeDb as never, async () => {
			expect(getDb()).toBe(fakeDb);
		});
	});
});
