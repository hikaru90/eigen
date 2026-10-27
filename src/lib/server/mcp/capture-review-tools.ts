import type { McpToolContext } from './tools'
import { getCaptureReviewView } from '$lib/server/capture-review/review-view'
import { voteOnCapture } from '$lib/server/capture-review/vote'
import { isCaptureVoteThoughtId, validateCaptureVote } from '$lib/server/capture-review/vote-input'
import { sanitizeMcpToolResult } from '$lib/server/observability/strip-embeddings'
import { strictToolArgs } from '$lib/server/validation/mcp-args'

/**
 * Capture feedback C3 (docs/planning/capture-feedback.md §7): the two tools that make the capture
 * review drivable by an agent. HTTP MCP only; the in-app Ask agent never gets them (the vote in the
 * app lives in two places, the Capture strip and the Mesh row).
 *
 * Budget (docs/testing/agent-benchmark.md): capture_thought → get_capture_review → rate_capture,
 * 3 calls. Arguments are checked strictly at the boundary, before any DB or Jev work: unknown
 * keys, a thought_id that is not a uuid, a verdict that is not up or down, and a reason that
 * cannot apply all fail with the exact constraint.
 */

function readThoughtId(value: unknown): string {
  if (!isCaptureVoteThoughtId(value)) throw new Error('thought_id must be a uuid')
  return value
}

/** How sure Eigen is that it stored one thought right: status, score, parts in words, the vote. */
export async function runGetCaptureReviewTool(context: McpToolContext, args: unknown) {
  const body = strictToolArgs(args, ['thought_id'])
  const thoughtId = readThoughtId(body.thought_id)
  return sanitizeMcpToolResult(await getCaptureReviewView({ userId: context.userId, thoughtId }))
}

/**
 * The owner's vote on a stored thought, cast by an agent: the same service as the app's 👍/👎
 * (`voteOnCapture`), with the place `mcp`, which is stored as no place.
 */
export async function runRateCaptureTool(context: McpToolContext, args: unknown) {
  const body = strictToolArgs(args, ['thought_id', 'verdict', 'reason'])
  const thoughtId = readThoughtId(body.thought_id)
  const vote = validateCaptureVote({
    thoughtId,
    verdict: body.verdict,
    place: 'mcp',
    reason: body.reason,
  })

  const result = await voteOnCapture({ userId: context.userId, ...vote })
  return sanitizeMcpToolResult({
    verdict: result.verdict,
    reason_kind: result.reasonKind,
    edit_applied: result.editApplied,
    changed: result.changed,
    edit_error: result.editError,
    ...(result.thought ? { thought: result.thought } : {}),
  })
}
