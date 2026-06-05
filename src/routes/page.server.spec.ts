import { describe, expect, it } from 'vitest';
import { load } from './+page.server';

describe('root page server', () => {
	it('redirects authenticated users to capture', () => {
		const event = { locals: { user: { id: 'u_1' } } } as Parameters<typeof load>[0];
		expect(() => load(event)).toThrow(
			expect.objectContaining({ status: 302, location: '/capture' })
		);
	});

	it('redirects unauthenticated users to login', () => {
		const event = { locals: { user: null } } as Parameters<typeof load>[0];
		expect(() => load(event)).toThrow(
			expect.objectContaining({ status: 302, location: '/login' })
		);
	});
});
