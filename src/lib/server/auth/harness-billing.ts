/** Platform wallet debited for graph-scale benchmark harness tenants. */
export const GRAPH_SCALE_OPERATOR_USER_ID = 'graph-scale-runner';

/** Default eval CLI operator (see evals/harness/eval-config.ts). */
export const EVAL_OPERATOR_USER_ID = 'eval-runner-operator';

/** LongMemEval harness operator (see evals/longmemeval/ensure-operator.ts). */
export const LONGMEMEVAL_OPERATOR_USER_ID = 'longmemeval-runner';

/**
 * Map harness corpus tenant ids to the operator wallet that funds LLM usage.
 * Id-prefix rules only — not semantic classification.
 */
export function resolveHarnessBillingUserId(tenantUserId: string): string | undefined {
	const id = tenantUserId.trim();
	if (!id) return undefined;

	if (
		id === GRAPH_SCALE_OPERATOR_USER_ID ||
		id === EVAL_OPERATOR_USER_ID ||
		id === LONGMEMEVAL_OPERATOR_USER_ID
	) {
		return id;
	}
	if (id.startsWith('graph-scale-corpus-')) {
		return GRAPH_SCALE_OPERATOR_USER_ID;
	}
	if (id.startsWith('eval-corpus-')) {
		const operator = id.slice('eval-corpus-'.length);
		return operator.length > 0 ? operator : EVAL_OPERATOR_USER_ID;
	}
	if (id.startsWith('longmemeval-corpus-')) {
		return LONGMEMEVAL_OPERATOR_USER_ID;
	}
	return undefined;
}
