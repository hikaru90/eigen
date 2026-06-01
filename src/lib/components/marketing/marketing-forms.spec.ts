import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const marketingDir = resolve(import.meta.dirname);

function readComponent(name: string): string {
	return readFileSync(resolve(marketingDir, name), 'utf8');
}

describe('marketing forms (UI-only)', () => {
	it('newsletter does not call fetch', () => {
		const src = readComponent('marketing-newsletter.svelte');
		expect(src).not.toMatch(/\bfetch\s*\(/);
		expect(src).toContain('Join waitlist');
		expect(src).toContain('not wired yet');
	});

	it('contact does not call fetch', () => {
		const src = readComponent('marketing-contact.svelte');
		expect(src).not.toMatch(/\bfetch\s*\(/);
		expect(src).toContain('Preview send');
		expect(src).toContain('not wired yet');
	});
});
