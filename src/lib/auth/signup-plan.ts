export type SignupPlan = 'managed' | 'self-hosted';

const SIGNUP_PLANS = new Set<SignupPlan>(['managed', 'self-hosted']);

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
