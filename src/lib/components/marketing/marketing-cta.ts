export const MARKETING_PRIMARY_CTA = 'Get early access';
export const MARKETING_LOGGED_IN_CTA = 'Open app';
export const MARKETING_SIGNUP_PATH = '/signup';
export const MARKETING_APP_PATH = '/capture';

export type SignupPlan = 'managed' | 'self-hosted';

const SIGNUP_PLANS = new Set<SignupPlan>(['managed', 'self-hosted']);

export function signupHref(plan?: SignupPlan): string {
	if (!plan) return MARKETING_SIGNUP_PATH;
	return `${MARKETING_SIGNUP_PATH}?plan=${plan}`;
}

export function pricingCtaLabel(plan: SignupPlan): string {
	return plan === 'managed'
		? 'Get early access — managed'
		: 'Get early access — self-hosted';
}

export function parseSignupPlanParam(value: string | null): SignupPlan | null {
	if (value === null) return null;
	if (!SIGNUP_PLANS.has(value as SignupPlan)) {
		return null;
	}
	return value as SignupPlan;
}

export function signupPlanSubtitle(plan: SignupPlan): string {
	return plan === 'managed'
		? 'Creating your account for managed hosting'
		: 'Creating your account for self-hosted deployment';
}
