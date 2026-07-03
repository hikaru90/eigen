import { describe, expect, it } from 'vitest';
import { parseGraphScaleCli, SPEND_CONFIRM_THRESHOLD } from './cli';

describe('parseGraphScaleCli', () => {
	it('defaults sizes and capture track for smoke runs', () => {
		const cli = parseGraphScaleCli([]);
		expect(cli.sizes).toEqual([1]);
		expect(cli.tracks.has('capture')).toBe(true);
		expect(cli.tracks.has('qa')).toBe(false);
		expect(cli.tracks.has('consolidation')).toBe(false);
	});

	it('parses custom sizes and tracks', () => {
		const cli = parseGraphScaleCli(['--sizes', '25,50', '--tracks', 'qa']);
		expect(cli.sizes).toEqual([25, 50]);
		expect(cli.tracks.size).toBe(1);
		expect(cli.tracks.has('qa')).toBe(true);
	});

	it('requires confirm-spend above threshold', () => {
		expect(() =>
			parseGraphScaleCli(['--sizes', String(SPEND_CONFIRM_THRESHOLD + 1)])
		).toThrow(/confirm-spend/);
		expect(() =>
			parseGraphScaleCli(['--sizes', String(SPEND_CONFIRM_THRESHOLD + 1), '--confirm-spend'])
		).not.toThrow();
	});
});
