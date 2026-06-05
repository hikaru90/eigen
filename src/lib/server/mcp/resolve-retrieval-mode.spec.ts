import { describe, expect, it } from 'vitest';
import { resolveMcpRetrievalMode } from './resolve-retrieval-mode';

describe('resolveMcpRetrievalMode', () => {
	it('defaults local queries to fast', () => {
		expect(resolveMcpRetrievalMode('recent meeting notes')).toBe('fast');
	});

	it('upgrades relational queries to full', () => {
		expect(resolveMcpRetrievalMode('Who is Jonas?')).toBe('full');
	});

	it('honors explicit mode override', () => {
		expect(resolveMcpRetrievalMode('Who is Jonas?', 'fast')).toBe('fast');
		expect(resolveMcpRetrievalMode('hello', 'full')).toBe('full');
	});
});
