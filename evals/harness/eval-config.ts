/**
 * Shared eval config: stable user ids and other constants imported by both
 * the seed harness and the runners. Kept tiny so importing it never triggers
 * any eval-side effects.
 */
export const EVAL_RETRIEVAL_USER_ID = 'eval-runner-retrieval';
export const EVAL_JUDGE_USER_ID = 'eval-runner-judge';

/**
 * Generate a unique eval user id for a single agent ingest eval run.
 *
 * Using a timestamp suffix ensures each run gets a clean-slate user with no
 * pre-existing thoughts, reflecting real agent cold-start behavior. The
 * harness is responsible for creating and cleaning up this user row.
 */
export function newEvalAgentUserId(): string {
	return `eval-agent-${Date.now()}`;
}
