import { describe, expect, it } from 'vitest';
import {
	MARKETING_PRIMARY_CTA,
	MARKETING_SIGNUP_PATH,
	parseSignupPlanParam,
	pricingCtaLabel,
	signupHref,
	signupPlanSubtitle
} from './marketing-cta';

describe('marketing-cta', () => {
	it('signupHref returns base path without plan', () => {
		expect(signupHref()).toBe(MARKETING_SIGNUP_PATH);
	});

	it('signupHref includes plan query for deployment choice', () => {
		expect(signupHref('managed')).toBe('/signup?plan=managed');
		expect(signupHref('self-hosted')).toBe('/signup?plan=self-hosted');
	});

	it('pricingCtaLabel uses primary CTA family', () => {
		expect(pricingCtaLabel('managed')).toBe('Get early access — managed');
		expect(pricingCtaLabel('self-hosted')).toBe('Get early access — self-hosted');
	});

	it('parseSignupPlanParam accepts valid plans and rejects unknown', () => {
		expect(parseSignupPlanParam(null)).toBeNull();
		expect(parseSignupPlanParam('managed')).toBe('managed');
		expect(parseSignupPlanParam('self-hosted')).toBe('self-hosted');
		expect(parseSignupPlanParam('enterprise')).toBeNull();
		expect(parseSignupPlanParam('')).toBeNull();
	});

	it('signupPlanSubtitle describes deployment context', () => {
		expect(signupPlanSubtitle('managed')).toContain('managed hosting');
		expect(signupPlanSubtitle('self-hosted')).toContain('self-hosted');
	});

	it('exports consistent primary CTA copy', () => {
		expect(MARKETING_PRIMARY_CTA).toBe('Get early access');
	});
});
