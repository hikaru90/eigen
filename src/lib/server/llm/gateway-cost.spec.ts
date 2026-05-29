import { describe, expect, it } from 'vitest';
import {
	extractGatewayReportedCostUsd,
	gatewayReportedCostUsdForLog,
	requireGatewayReportedCostUsd
} from './gateway-cost';

describe('extractGatewayReportedCostUsd', () => {
	it('reads provider-reported usage.cost', () => {
		expect(
			extractGatewayReportedCostUsd({
				usage: { prompt_tokens: 1000, completion_tokens: 500, cost: 0.0025 }
			})
		).toBe(0.0025);
	});

	it('returns null when cost is absent (no token inference)', () => {
		expect(extractGatewayReportedCostUsd({ usage: { prompt_tokens: 1000, completion_tokens: 1000 } })).toBe(
			null
		);
		expect(extractGatewayReportedCostUsd(undefined)).toBe(null);
		expect(extractGatewayReportedCostUsd({})).toBe(null);
	});
});

describe('requireGatewayReportedCostUsd', () => {
	it('throws when cost is missing', () => {
		expect(() => requireGatewayReportedCostUsd({ usage: { total_tokens: 10 } })).toThrow(/usage\.cost/);
	});
});

describe('gatewayReportedCostUsdForLog', () => {
	it('returns 0 when cost is missing', () => {
		expect(gatewayReportedCostUsdForLog({ usage: { total_tokens: 10 } })).toBe(0);
	});
});
