import { describe, expect, it } from 'vitest';
import {
	EVAL_OPERATOR_USER_ID,
	GRAPH_SCALE_OPERATOR_USER_ID,
	LONGMEMEVAL_OPERATOR_USER_ID,
	resolveHarnessBillingUserId
} from './harness-billing';

describe('resolveHarnessBillingUserId', () => {
	it('maps graph-scale corpus tenants to graph-scale-runner', () => {
		expect(resolveHarnessBillingUserId('graph-scale-corpus-run-uuid-1')).toBe(
			GRAPH_SCALE_OPERATOR_USER_ID
		);
	});

	it('maps eval corpus tenants to their operator suffix', () => {
		expect(resolveHarnessBillingUserId('eval-corpus-eval-runner-operator')).toBe(
			EVAL_OPERATOR_USER_ID
		);
	});

	it('maps longmemeval corpus tenants to longmemeval-runner', () => {
		expect(resolveHarnessBillingUserId('longmemeval-corpus-gpt4_2655')).toBe(
			LONGMEMEVAL_OPERATOR_USER_ID
		);
	});

	it('returns operator ids for operator rows', () => {
		expect(resolveHarnessBillingUserId(GRAPH_SCALE_OPERATOR_USER_ID)).toBe(
			GRAPH_SCALE_OPERATOR_USER_ID
		);
	});

	it('returns undefined for production tenants', () => {
		expect(resolveHarnessBillingUserId('real-user-uuid')).toBeUndefined();
	});
});
