import { describe, expect, it } from 'vitest';
import { load } from './+layout.server';

describe('layout server load', () => {
	it('returns user or null', () => {
		expect(load({ locals: { user: { id: 'u1' } } } as never)).toEqual({ user: { id: 'u1' } });
		expect(load({ locals: { user: undefined } } as never)).toEqual({ user: null });
	});
});
