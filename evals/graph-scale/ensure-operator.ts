import { insertEvalUserRow } from '$lib/eval/store';
import { GRAPH_SCALE_OPERATOR_USER_ID } from '$lib/server/auth/harness-billing';

export { GRAPH_SCALE_OPERATOR_USER_ID };

/** Ensure operator exists with enough platform credits for benchmark LLM spend. */
export async function ensureGraphScaleOperatorReady(): Promise<void> {
	await insertEvalUserRow(GRAPH_SCALE_OPERATOR_USER_ID, 'Graph scale benchmark operator');
}
