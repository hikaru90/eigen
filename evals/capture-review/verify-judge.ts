import type { CaptureQuality } from '$lib/server/capture-review/admin-quality'
import { CAPTURE_REVIEW_THRESHOLD, SCORED_PARTS } from '$lib/server/capture-review/review-parts'

/**
 * The pure judgments of `npm run capture-review:verify` (docs/planning/capture-feedback.md, C5):
 * did the review catch the injected mistake, which other parts moved, did the vote land as the
 * contract says, did the operator counts move by the expected amounts. Pure comparisons of labels,
 * probabilities and counts the pipeline stored; nothing here reads a capture's text.
 */

export type VerifyPart = {
  part: string
  ref: string
  engine: string
  label: string
  probability: number
}

export type ReviewSnapshot = {
  status: string
  score: number | null
  parts: VerifyPart[]
}

export type CaseTarget = {
  part: string
  /** The exact part ref, or null for a whole-capture part (wording, missing_names, ...). */
  ref: string | null
  negativeLabel: string
}

export type CaseOutcome = {
  pass: boolean
  reasons: string[]
  /** The targeted part's label and P(right) after the injection; null for a clean case or no part. */
  targetLabel: string | null
  targetProbability: number | null
  /** Label flips, new and vanished parts other than the target, between before and after. */
  otherChanges: string[]
  /** A mistake case whose review was already below the threshold before the injection. */
  beforeWeak: boolean
}

const scoredPartSet: ReadonlySet<string> = new Set(SCORED_PARTS)
const fixed = (n: number): string => n.toFixed(4)

/** The lowest-probability part that counts toward the score; null when there is none. */
export function weakestScoredPart(parts: VerifyPart[]): VerifyPart | null {
  let weakest: VerifyPart | null = null
  for (const p of parts) {
    if (!scoredPartSet.has(p.part)) continue
    if (weakest === null || p.probability < weakest.probability) weakest = p
  }
  return weakest
}

function matchesTarget(p: VerifyPart, target: { part: string; ref: string | null }): boolean {
  return p.part === target.part && (target.ref === null || p.ref === target.ref)
}

/**
 * What changed besides the target, by part ref: a label that flipped (`wording right>wrong`), a part
 * that vanished (`name:n1 gone`) and a part that appeared (`missing_names new`). Probability moves
 * that keep the label are not changes.
 */
export function otherPartChanges(
  before: VerifyPart[],
  after: VerifyPart[],
  target: { part: string; ref: string | null } | null,
): string[] {
  const skip = (p: VerifyPart) => target !== null && matchesTarget(p, target)
  const keyOf = (p: VerifyPart) => `${p.part}|${p.ref}`
  const afterByKey = new Map(after.map((p) => [keyOf(p), p]))
  const beforeKeys = new Set(before.map(keyOf))
  const changes: string[] = []
  for (const p of before) {
    if (skip(p)) continue
    const next = afterByKey.get(keyOf(p))
    if (!next) changes.push(`${p.ref} gone`)
    else if (next.label !== p.label) changes.push(`${p.ref} ${p.label}>${next.label}`)
  }
  for (const p of after) {
    if (skip(p) || beforeKeys.has(keyOf(p))) continue
    changes.push(`${p.ref} new`)
  }
  return changes
}

export type EvaluateInput = {
  kind: 'clean' | 'mistake'
  target: CaseTarget | null
  /** The review before any injection (the only one for a clean case). */
  before: ReviewSnapshot | null
  /** The review after the injection and the second audit; null for a clean case. */
  after: ReviewSnapshot | null
  /** Set when the injection could not be applied (a stored precondition did not hold). */
  setupError?: string | null
}

function notScored(label: string, review: ReviewSnapshot | null): string | null {
  if (review === null) return `${label} review is missing`
  if (review.status !== 'scored' || review.score === null) {
    return `${label} review is ${review.status}, not scored`
  }
  return null
}

/**
 * Clean case: PASS when scored at or above the threshold. Mistake case: PASS when the targeted part
 * has the negative label AND the score is below the threshold. Never softened: a case that was weak
 * before the injection is flagged (`beforeWeak`), not excused.
 */
export function evaluateCase(input: EvaluateInput): CaseOutcome {
  const { kind, target, before, after } = input
  const beforeWeak =
    kind === 'mistake' &&
    before !== null &&
    before.score !== null &&
    before.score < CAPTURE_REVIEW_THRESHOLD
  const base = {
    targetLabel: null,
    targetProbability: null,
    otherChanges: [] as string[],
    beforeWeak,
  }

  if (input.setupError) {
    return { ...base, pass: false, reasons: [`setup: ${input.setupError}`] }
  }

  if (kind === 'clean') {
    const problem = notScored('the', before)
    if (problem) return { ...base, pass: false, reasons: [problem] }
    const score = before!.score!
    if (score < CAPTURE_REVIEW_THRESHOLD) {
      return {
        ...base,
        pass: false,
        reasons: [`score ${fixed(score)} is below the threshold ${CAPTURE_REVIEW_THRESHOLD}`],
      }
    }
    return { ...base, pass: true, reasons: [] }
  }

  if (target === null) throw new Error('[capture-review] a mistake case needs a target')
  const problem = notScored('the after-injection', after)
  if (problem) return { ...base, pass: false, reasons: [problem] }

  const found = after!.parts.find((p) => matchesTarget(p, target))
  const otherChanges = otherPartChanges(before?.parts ?? [], after!.parts, target)
  const name = target.ref ?? target.part
  const reasons: string[] = []
  if (!found) {
    reasons.push(`no ${name} part in the review`)
  } else if (found.label !== target.negativeLabel) {
    reasons.push(`${found.ref} is "${found.label}", expected "${target.negativeLabel}"`)
  }
  const score = after!.score!
  if (!(score < CAPTURE_REVIEW_THRESHOLD)) {
    reasons.push(`score ${fixed(score)} is not below the threshold ${CAPTURE_REVIEW_THRESHOLD}`)
  }
  return {
    pass: reasons.length === 0,
    reasons,
    targetLabel: found?.label ?? null,
    targetProbability: found?.probability ?? null,
    otherChanges,
    beforeWeak,
  }
}

export type Check = {
  name: string
  ok: boolean
  expected: string
  actual: string
}

export type ExpectedQualityDeltas = {
  /** Every review the run created (the captures and their split children). */
  reviews: number
  votes: Record<'capture' | 'mesh' | 'mcp', { up: number; down: number }>
  downWithoutReason: number
  /** Votes per reason kind (only the kinds named are checked). */
  reasonKinds: Record<string, number>
}

const signed = (n: number): string => (n >= 0 ? `+${n}` : `${n}`)

/** The change in the operator counts between two `loadCaptureQuality` reads, against what the votes imply. */
export function qualityDeltaChecks(
  before: CaptureQuality,
  after: CaptureQuality,
  expected: ExpectedQualityDeltas,
): Check[] {
  const rows: Array<[string, number, number, number]> = [
    ['reviews', before.totals.reviews, after.totals.reviews, expected.reviews],
  ]
  for (const place of ['capture', 'mesh', 'mcp'] as const) {
    for (const verdict of ['up', 'down'] as const) {
      rows.push([
        `votes.${place}.${verdict}`,
        before.totals.votes[place][verdict],
        after.totals.votes[place][verdict],
        expected.votes[place][verdict],
      ])
    }
  }
  rows.push([
    'downWithoutReason',
    before.totals.downWithoutReason,
    after.totals.downWithoutReason,
    expected.downWithoutReason,
  ])
  const kindCount = (q: CaptureQuality, kind: string): number =>
    (q.reasonKinds as Record<string, number>)[kind] ?? Number.NaN
  for (const [kind, want] of Object.entries(expected.reasonKinds)) {
    rows.push([`reasonKinds.${kind}`, kindCount(before, kind), kindCount(after, kind), want])
  }
  return rows.map(([name, b, a, want]) => ({
    name,
    ok: a - b === want,
    expected: signed(want),
    actual: signed(a - b),
  }))
}

/**
 * What the operator counts must show after the votes: the final stored vote of each voted thought
 * (a re-vote replaced the earlier one). A vote cast over MCP has no place (`votedOn` null).
 */
export function expectedQualityDeltas(
  reviews: number,
  finals: Array<Pick<StoredVote, 'verdict' | 'votedOn' | 'reasonKind' | 'reasonStored'>>,
): ExpectedQualityDeltas {
  const votes: ExpectedQualityDeltas['votes'] = {
    capture: { up: 0, down: 0 },
    mesh: { up: 0, down: 0 },
    mcp: { up: 0, down: 0 },
  }
  const reasonKinds: Record<string, number> = {}
  let downWithoutReason = 0
  for (const vote of finals) {
    if (vote.verdict === null) continue
    votes[vote.votedOn ?? 'mcp'][vote.verdict] += 1
    if (vote.verdict === 'down' && !vote.reasonStored) downWithoutReason += 1
    if (vote.reasonKind !== null)
      reasonKinds[vote.reasonKind] = (reasonKinds[vote.reasonKind] ?? 0) + 1
  }
  return { reviews, votes, downWithoutReason, reasonKinds }
}

export type StoredVote = {
  verdict: 'up' | 'down' | null
  /** NULL for a vote cast over MCP. */
  votedOn: 'capture' | 'mesh' | null
  reasonKind: string | null
  /** Whether an encrypted reason is stored (the text itself is never read). */
  reasonStored: boolean
  editAppliedAt: Date | null
}

export type ExpectedVote = {
  verdict: 'up' | 'down'
  votedOn: 'capture' | 'mesh' | null
  /** The exact label; null for none; undefined for "Jev's label, whichever it is, but a label". */
  reasonKind: string | null | undefined
  reasonStored: boolean
  edit: boolean
}

/** A stored vote row against what the vote contract says it must look like. */
export function voteRowChecks(expected: ExpectedVote, row: StoredVote): Check[] {
  const show = (v: unknown): string => (v === null || v === undefined ? 'none' : String(v))
  const rows: Array<[string, unknown, unknown]> = [
    ['verdict', expected.verdict, row.verdict],
    ['voted_on', expected.votedOn, row.votedOn],
    [
      'reason_kind',
      expected.reasonKind === undefined
        ? row.reasonKind === null
          ? 'a label'
          : row.reasonKind
        : expected.reasonKind,
      row.reasonKind,
    ],
    ['reason', expected.reasonStored ? 'stored' : 'none', row.reasonStored ? 'stored' : 'none'],
    ['edit_applied_at', expected.edit ? 'set' : 'none', row.editAppliedAt ? 'set' : 'none'],
  ]
  return rows.map(([name, want, got]) => ({
    name,
    ok:
      show(want) === show(got) &&
      !(expected.reasonKind === undefined && name === 'reason_kind' && row.reasonKind === null),
    expected: show(want),
    actual: show(got),
  }))
}
