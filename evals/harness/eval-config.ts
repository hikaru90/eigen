/**
 * Shared eval config: stable user ids and other constants imported by both
 * the seed harness and the runners. Kept tiny so importing it never triggers
 * any eval-side effects.
 */
export const EVAL_RETRIEVAL_USER_ID = 'eval-runner-retrieval';
export const EVAL_JUDGE_USER_ID = 'eval-runner-judge';
