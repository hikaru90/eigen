import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const routesDir = resolve(import.meta.dirname);

describe('marketing static routes', () => {
	const pages = ['privacy', 'terms', 'imprint'] as const;

	for (const slug of pages) {
		it(`has ${slug} page component`, () => {
			expect(existsSync(resolve(routesDir, slug, '+page.svelte'))).toBe(true);
		});
	}

	it('has developer docs layout and dynamic page', () => {
		expect(existsSync(resolve(routesDir, 'developers', '+layout.svelte'))).toBe(true);
		expect(existsSync(resolve(routesDir, 'developers', '[slug]', '+page.svelte'))).toBe(true);
		expect(existsSync(resolve(routesDir, 'developers', '+page.ts'))).toBe(true);
	});
});
