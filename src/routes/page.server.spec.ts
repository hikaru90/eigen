import { describe, expect, it } from 'vitest';
import { load } from './+page.server';

describe('root page server', () => {
	it('does not redirect authenticated users from landing page', () => {
		const event = { locals: { user: { id: 'u_1' } } } as Parameters<typeof load>[0];
		expect(load(event)).toEqual({});
	});

	it('renders landing page for unauthenticated users', () => {
		const event = { locals: { user: null } } as Parameters<typeof load>[0];
		expect(load(event)).toEqual({});
	});
});
