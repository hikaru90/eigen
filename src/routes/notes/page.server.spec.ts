import { describe, expect, it } from 'vitest';
import { load } from './+page.server';

describe('notes legacy redirect', () => {
	it('redirects /notes to /memory/notes', async () => {
		await expect(
			load({ locals: { user: { id: 'u1' } }, url: new URL('http://localhost/notes') } as never)
		).rejects.toMatchObject({ status: 302, location: '/memory/notes' });
	});

	it('preserves note deep link', async () => {
		await expect(
			load({
				locals: { user: { id: 'u1' } },
				url: new URL('http://localhost/notes?note=n1')
			} as never)
		).rejects.toMatchObject({ status: 302, location: '/memory/notes?note=n1' });
	});
});
