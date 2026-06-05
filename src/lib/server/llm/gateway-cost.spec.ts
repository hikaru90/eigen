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

	it('reads top-level cost before usage.cost', () => {
		expect(extractGatewayReportedCostUsd({ cost: 0.01, usage: { cost: 0.002 } })).toBe(0.01);
	});

	it('parses string cost values', () => {
		expect(extractGatewayReportedCostUsd({ usage: { cost: '0.0035' } })).toBe(0.0035);
	});

	it('ignores zero, negative, and non-numeric costs', () => {
		expect(extractGatewayReportedCostUsd({ cost: 0 })).toBe(null);
		expect(extractGatewayReportedCostUsd({ usage: { cost: -0.01 } })).toBe(null);
		expect(extractGatewayReportedCostUsd({ usage: { cost: 'not-a-number' } })).toBe(null);
	});
});

describe('requireGatewayReportedCostUsd', () => {
	it('throws when cost is missing', () => {
		expect(() => requireGatewayReportedCostUsd({ usage: { total_tokens: 10 } })).toThrow(/usage\.cost/);
	});

	it('returns provider-reported cost when present', () => {
		expect(requireGatewayReportedCostUsd({ usage: { cost: 0.0042 } })).toBe(0.0042);
	});
});

describe('gatewayReportedCostUsdForLog', () => {
	it('returns 0 when cost is missing', () => {
		expect(gatewayReportedCostUsdForLog({ usage: { total_tokens: 10 } })).toBe(0);
	});

	it('returns reported cost when present', () => {
		expect(gatewayReportedCostUsdForLog({ usage: { cost: 0.007 } })).toBe(0.007);
	});
});
