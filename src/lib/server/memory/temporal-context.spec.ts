import { describe, expect, it } from 'vitest';
import {
	compactTemporalFieldsForMcp,
	enhanceSnippetWithTemporalContext
} from './temporal-context';

describe('compactTemporalFieldsForMcp', () => {
	it('returns none when no temporal context exists', () => {
		expect(compactTemporalFieldsForMcp(undefined, new Date('2026-06-05T12:00:00.000Z'))).toEqual({
			temporalStatus: 'none',
			temporalSummary: undefined
		});
	});

	it('returns expired summary for past events', () => {
		const now = new Date('2026-06-05T12:00:00.000Z');
		const { temporalStatus, temporalSummary } = compactTemporalFieldsForMcp(
			{
				temporalStatus: 'expired',
				temporalEvents: [
					{
						kind: 'reminder',
						semanticSummary: 'separate eigenmesh app',
						activePeriod: '[2026-06-02T12:00:00.000Z,2026-06-02T18:00:00.000Z)',
						expired: true
					}
				]
			},
			now
		);
		expect(temporalStatus).toBe('expired');
		expect(temporalSummary).toContain('EXPIRED');
		expect(temporalSummary).toContain('separate eigenmesh app');
	});
});

describe('enhanceSnippetWithTemporalContext', () => {
	it('appends stored date and temporal summary to snippet', () => {
		const out = enhanceSnippetWithTemporalContext({
			snippet: 'ich würde heute nachmittag gerne die app trennen',
			storedAt: new Date('2026-06-02T10:00:00.000Z'),
			temporalStatus: 'expired',
			temporalSummary: '"separate app" (Jun 2, 2026) — EXPIRED'
		});
		expect(out).toContain('ich würde heute nachmittag');
		expect(out).toContain('stored 2026-06-02');
		expect(out).toContain('EXPIRED');
	});
});
