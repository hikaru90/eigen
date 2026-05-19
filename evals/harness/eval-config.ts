/**
 * Shared eval config: stable user ids and other constants imported by both
 * the seed harness and the runners. Kept tiny so importing it never triggers
 * any eval-side effects.
 */
export const EVAL_JUDGE_USER_ID = 'eval-runner-judge';

/** Default operator for CLI eval runs (owns eval_run rows under RLS). */
export const EVAL_OPERATOR_USER_ID = 'eval-runner-operator';
