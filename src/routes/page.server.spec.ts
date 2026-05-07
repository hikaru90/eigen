import { describe, expect, it } from 'vitest';
import { load } from './+page.server';

describe('root page server', () => {
	it('redirects to capture', () => {
		expect(() => load()).toThrow();
	});
});
