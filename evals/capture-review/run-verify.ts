/**
 * `npm run capture-review:verify` (docs/planning/capture-feedback.md, C5): the live runner. Proves on
 * a real database, with the real Jev and real enrichment, that the capture review catches known
 * mistakes. Per case: capture + enrich, score the review, then (mistake cases) inject the mistake at
 * the source the audit reads, re-run the audit directly (same function the audit job calls) and
 * compare. Then the votes go through `voteOnCapture` and the operator counts are checked.
 *
 * It never fixes the product and never softens an expectation: a case that misbehaves is printed
 * with its numbers. Live only; the pure parts (cases, mutations, judge, report) are unit-tested.
 */

import type { VerifyArgs } from './verify-cli'
import { eq, inArray } from 'drizzle-orm'
import { deleteEvalUserRow, insertEvalUserRow } from '$lib/eval/store'
import {
  CAPTURE_REVIEW_VERIFY_TENANT_ID,
  PUBLIC_BENCH_OPERATOR_USER_ID,
  resolveHarnessBillingUserId,
} from '$lib/server/auth/harness-billing'
import { PLATFORM_CHAT_MODEL } from '$lib/server/billing/platform-llm'
import { loadCaptureQuality } from '$lib/server/capture-review/admin-quality'
import { loadCaptureAuditInput } from '$lib/server/capture-review/audit-input'
import { CAPTURE_REVIEW_AUDIT_MAX_ATTEMPTS } from '$lib/server/capture-review/job'
import { snapshotStoredData } from '$lib/server/capture-review/recheck'
import { parseCaptureReviewParts } from '$lib/server/capture-review/review-parts'
import { runCaptureReviewAudit } from '$lib/server/capture-review/run-audit'
import { voteOnCapture } from '$lib/server/capture-review/vote'
import type { CaptureVotePlace } from '$lib/server/capture-review/vote-input'
import { processCaptureEnrichQueue } from '$lib/server/capture/enrich-queued-thought'
import { captureThought } from '$lib/server/capture/service'
import { captureReview, thought } from '$lib/server/db/schema'
import { drainUserJobQueue } from '$lib/server/job-queue/drain'
import {
  resolveDecisionEnforceKinds,
  resolveDecisionShadowConfig,
} from '$lib/server/llm/decision-client'
import { readSplitFamily } from '$lib/server/memory/split-multi-task'
import { logEval, withEvalDb } from '../harness/eval-context'
import { aggregateRunCost } from '../public-bench/cost'
import { ensurePublicBenchOperator } from '../public-bench/ensure-operator'
import { loadVerifyCases, VERIFY_CASES_PATH, type VerifyCase } from './verify-fixture'
import { InjectionSetupError, injectMutation, resetReviewForReaudit } from './verify-inject'
import {
  evaluateCase,
  expectedQualityDeltas,
  qualityDeltaChecks,
  voteRowChecks,
  type CaseTarget,
  type Check,
  type ExpectedVote,
  type ReviewSnapshot,
  type StoredVote,
} from './verify-judge'
import { describeMutation, mutationTarget } from './verify-mutations'
import {
  formatVerifyReport,
  verifyExitCode,
  type VerifyCaseRow,
  type VoteCheckGroup,
} from './verify-report'

const TENANT = CAPTURE_REVIEW_VERIFY_TENANT_ID
const TENANT_NAME = 'Capture review verify tenant'
const AUDIT_ATTEMPTS = CAPTURE_REVIEW_AUDIT_MAX_ATTEMPTS

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

type Billing = { billingUserId: string }

/** The made-up reason of the wrong-date vote. */
const WRONG_DATE_REASON = 'wrong day, I said Friday'

/** A reason about a date that is already stored right: the re-check must change nothing. */
const NOTHING_CHANGES_REASON = 'Saturday is the right day, please just double-check the date'

/** A reason about a split that should not have happened. */
/** A complaint about the wording: the one kind of reason that rewrites the text. */
const WORDING_REASON = 'I only said maybe, I never said I would call her tomorrow'

const SPLIT_REASON =
  'this is one errand list for the morning, it should be a single to-do, not three'

async function readReview(thoughtId: string, billing: Billing): Promise<ReviewSnapshot | null> {
  return withEvalDb(
    TENANT,
    async (db) => {
      const [row] = await db
        .select({
          status: captureReview.status,
          score: captureReview.score,
          parts: captureReview.parts,
        })
        .from(captureReview)
        .where(eq(captureReview.thoughtId, thoughtId))
        .limit(1)
      if (!row) return null
      return {
        status: row.status,
        score: row.score,
        parts: parseCaptureReviewParts(row.parts),
      }
    },
    billing,
  )
}

async function readAuditView(thoughtId: string, billing: Billing) {
  return withEvalDb(TENANT, () => loadCaptureAuditInput({ userId: TENANT, thoughtId }), billing)
}

/** Runs the audit for one thought the way the job does, up to the ingest policy's 4 tries. */
async function auditDirectly(thoughtId: string, billing: Billing): Promise<void> {
  for (let attempt = 1; attempt <= AUDIT_ATTEMPTS; attempt++) {
    try {
      await withEvalDb(
        TENANT,
        () =>
          runCaptureReviewAudit({
            userId: TENANT,
            thoughtId,
            attempt,
            maxAttempts: AUDIT_ATTEMPTS,
          }),
        billing,
      )
      return
    } catch (err) {
      logEval(
        `audit attempt ${attempt}/${AUDIT_ATTEMPTS} failed: ${err instanceof Error ? err.message : String(err)}`,
      )
      if (attempt === AUDIT_ATTEMPTS) return
      await sleep(1000 * 2 ** (attempt - 1))
    }
  }
}

/** The review as scored: drains the tenant's queue (clears the queued audit jobs), then audits directly if still pending. */
async function scoredReview(thoughtId: string, billing: Billing): Promise<ReviewSnapshot | null> {
  const drained = await drainUserJobQueue({ userId: TENANT, limit: 50 })
  if (drained.claimed > 0) {
    logEval(
      `audit jobs: claimed ${drained.claimed}, completed ${drained.completed}, gave up ${drained.failed}`,
    )
  }
  let review = await readReview(thoughtId, billing)
  if (review?.status === 'pending_audit') {
    logEval(`thought ${thoughtId.slice(0, 8)}: still pending_audit, running the audit directly`)
    await auditDirectly(thoughtId, billing)
    review = await readReview(thoughtId, billing)
  }
  return review
}

const dayList = (view: Awaited<ReturnType<typeof readAuditView>>): string =>
  view === null || view.dates.length === 0
    ? 'none'
    : view.dates.map((d) => `${d.day ?? 'repeating'}${d.detail ? ` (${d.detail})` : ''}`).join('; ')

type CaseRun = { row: VerifyCaseRow; thoughtId: string; daysBefore: string }

async function runCase(c: VerifyCase, billing: Billing): Promise<CaseRun> {
  logEval(`case ${c.id}: capturing at ${c.capturedAt}`)
  const thoughtId = await withEvalDb(
    TENANT,
    async () => {
      const result = await captureThought(TENANT, c.text, {
        source: 'eval',
        awaitEnrichment: true,
        capturedAt: c.capturedAtDate,
      })
      // Split children are queued for enrichment; drain them like the smoke does.
      await processCaptureEnrichQueue(TENANT, { concurrency: 1 })
      return result.id
    },
    { ...billing, clock: c.capturedAtDate },
  )

  const before = await scoredReview(thoughtId, billing)
  const daysBefore = dayList(await readAuditView(thoughtId, billing))
  const mutation = c.mutation
  const base = {
    id: c.id,
    kind: c.kind,
    mutation: mutation ? describeMutation(mutation) : null,
    before,
  }
  if (mutation === null) {
    logEval(`case ${c.id}: clean, score ${before?.score ?? before?.status}`)
    return {
      thoughtId,
      daysBefore,
      row: {
        ...base,
        target: null,
        after: null,
        outcome: evaluateCase({ kind: 'clean', target: null, before, after: null }),
      },
    }
  }

  const wanted = mutationTarget(mutation)
  let target: CaseTarget = { part: wanted.part, ref: null, negativeLabel: wanted.negativeLabel }
  try {
    const injected = await injectMutation({
      userId: TENANT,
      thoughtId,
      mutation,
      auditView: () => readAuditView(thoughtId, billing),
      rankedNameRefs: (before?.parts ?? [])
        .filter((p) => p.part === 'name')
        .sort((a, b) => b.probability - a.probability)
        .map((p) => p.ref.replace(/^name:/, '')),
    })
    target = { ...target, ref: injected.targetRef }
    const notes = injected.notes ?? []
    await resetReviewForReaudit({ userId: TENANT, thoughtId })
    await auditDirectly(thoughtId, billing)
    const after = await readReview(thoughtId, billing)
    logEval(
      `case ${c.id}: injected ${describeMutation(mutation)}, score ${before?.score} -> ${after?.score}`,
    )
    return {
      thoughtId,
      daysBefore,
      row: {
        ...base,
        target,
        after,
        notes,
        outcome: evaluateCase({ kind: 'mistake', target, before, after }),
      },
    }
  } catch (err) {
    if (!(err instanceof InjectionSetupError)) throw err
    logEval(`case ${c.id}: setup failed: ${err.message}`)
    return {
      thoughtId,
      daysBefore,
      row: {
        ...base,
        target,
        after: null,
        outcome: evaluateCase({
          kind: 'mistake',
          target,
          before,
          after: null,
          setupError: err.message,
        }),
      },
    }
  }
}

async function readStoredVote(
  thoughtId: string,
  billing: Billing,
): Promise<StoredVote & { votedAt: Date | null }> {
  return withEvalDb(
    TENANT,
    async (db) => {
      const [row] = await db
        .select({
          verdict: captureReview.verdict,
          votedOn: captureReview.votedOn,
          reasonKind: captureReview.reasonKind,
          reasonEncrypted: captureReview.reasonEncrypted,
          editAppliedAt: captureReview.editAppliedAt,
          votedAt: captureReview.votedAt,
        })
        .from(captureReview)
        .where(eq(captureReview.thoughtId, thoughtId))
        .limit(1)
      if (!row) throw new Error(`[capture-review] no review row for thought ${thoughtId}`)
      return {
        verdict: row.verdict,
        votedOn: row.votedOn,
        reasonKind: row.reasonKind,
        reasonStored: row.reasonEncrypted !== null,
        editAppliedAt: row.editAppliedAt,
        votedAt: row.votedAt,
      }
    },
    billing,
  )
}

type VoteStep = {
  /** Report whether the stored data changed instead of asserting it. */
  reportChange?: boolean
  title: string
  thoughtId: string
  capturedAt: Date
  verdict: 'up' | 'down'
  place: CaptureVotePlace
  reason?: string
  expected: ExpectedVote
}

async function castVote(
  step: VoteStep,
  billing: Billing,
): Promise<
  VoteCheckGroup & {
    stored: StoredVote & { votedAt: Date | null }
    result: Awaited<ReturnType<typeof voteOnCapture>>
  }
> {
  logEval(`vote: ${step.title}`)
  const result = await withEvalDb(
    TENANT,
    () =>
      voteOnCapture({
        userId: TENANT,
        thoughtId: step.thoughtId,
        verdict: step.verdict,
        place: step.place,
        ...(step.reason === undefined ? {} : { reason: step.reason }),
      }),
    { ...billing, clock: step.capturedAt },
  )
  const stored = await readStoredVote(step.thoughtId, billing)
  const notes: string[] = []
  if (result.editError) notes.push(`the edit reported an error: ${result.editError}`)
  return {
    title: step.title,
    checks: step.reportChange
      ? voteRowChecks(step.expected, stored).filter((c) => c.name !== 'edit_applied_at')
      : [
          ...voteRowChecks(step.expected, stored),
          {
            name: 'changed',
            ok: result.changed === step.expected.edit,
            expected: String(step.expected.edit),
            actual: String(result.changed),
          },
        ],
    notes: step.reportChange
      ? [
          ...notes,
          `changed ${result.changed}, edit_applied_at ${stored.editAppliedAt ? 'set' : 'null'}`,
        ]
      : notes,
    stored,
    result,
  }
}

async function countReviews(billing: Billing): Promise<number> {
  return withEvalDb(
    TENANT,
    async (db) => (await db.select({ id: captureReview.id }).from(captureReview)).length,
    billing,
  )
}

/** Runs the whole verification; resolves to the process exit code (0 when every case and check passes). */
export async function runVerify(args: VerifyArgs): Promise<number> {
  const cases = loadVerifyCases(VERIFY_CASES_PATH)

  const billingUserId = resolveHarnessBillingUserId(TENANT)
  if (billingUserId !== PUBLIC_BENCH_OPERATOR_USER_ID) {
    throw new Error(
      `[capture-review] tenant ${TENANT} resolves to billing wallet ${billingUserId ?? '(none)'}, not ${PUBLIC_BENCH_OPERATOR_USER_ID}`,
    )
  }
  if (resolveDecisionShadowConfig() === null) {
    throw new Error(
      '[capture-review] the verify run needs the Jev decision model: set DECISION_SHADOW_ENABLED=true, OPENROUTER_API_KEY and DECISION_SHADOW_MODEL',
    )
  }
  const billing: Billing = { billingUserId }
  await ensurePublicBenchOperator({
    operatorUserId: billingUserId,
    displayName: 'Public Bench Runner',
    chatModel: PLATFORM_CHAT_MODEL,
  })

  logEval(
    `capture-review verify: tenant ${TENANT}, billed to ${billingUserId}, chat model ${PLATFORM_CHAT_MODEL} (platform default), ` +
      `DECISION_ENFORCE_KINDS=${[...resolveDecisionEnforceKinds()].join(',') || '(none)'}, ${cases.length} case(s), no eval LLM cache`,
  )

  if (args.keep) {
    await insertEvalUserRow(TENANT, TENANT_NAME)
    logEval(`--keep: tenant ${TENANT} kept as it is`)
  } else {
    await deleteEvalUserRow(TENANT)
    await insertEvalUserRow(TENANT, TENANT_NAME)
    logEval(`tenant ${TENANT} reset`)
  }

  const qualityBefore = await loadCaptureQuality({ includeHarness: true })

  const runs: CaseRun[] = []
  for (const c of cases) runs.push(await runCase(c, billing))
  const thoughtOf = new Map(runs.map((r) => [r.row.id, r.thoughtId]))
  const caseOf = new Map(cases.map((c) => [c.id, c]))
  const need = (id: string) => {
    const thoughtId = thoughtOf.get(id)
    const c = caseOf.get(id)
    if (!thoughtId || !c) throw new Error(`[capture-review] vote plan names unknown case "${id}"`)
    return { thoughtId, capturedAt: c.capturedAtDate }
  }

  // --- votes, through the real voteOnCapture ---
  const voteGroups: VoteCheckGroup[] = []
  const notes: string[] = []
  const noReason = { reasonKind: null, reasonStored: false, edit: false } as const

  const up = await castVote(
    {
      title: 'thumbs up on clean_weekday_en (place capture)',
      ...need('clean_weekday_en'),
      verdict: 'up',
      place: 'capture',
      expected: { verdict: 'up', votedOn: 'capture', ...noReason },
    },
    billing,
  )
  voteGroups.push(up)

  const emptyDown = await castVote(
    {
      title:
        'thumbs down, empty reason, on invented_name_en (place mesh): verdict only, no label, no edit',
      ...need('invented_name_en'),
      verdict: 'down',
      place: 'mesh',
      reason: '',
      expected: { verdict: 'down', votedOn: 'mesh', ...noReason },
    },
    billing,
  )
  voteGroups.push(emptyDown)

  const dateCase = need('wrong_date_en')
  const injectedDays = dayList(await readAuditView(dateCase.thoughtId, billing))
  const originalDays = runs.find((r) => r.row.id === 'wrong_date_en')?.daysBefore ?? 'unknown'
  const withReason = await castVote(
    {
      title: `thumbs down with a reason on wrong_date_en (place mesh): label wrong_date, the date is read again and fixed`,
      ...dateCase,
      verdict: 'down',
      place: 'mesh',
      reason: WRONG_DATE_REASON,
      expected: {
        verdict: 'down',
        votedOn: 'mesh',
        reasonKind: 'wrong_date',
        reasonStored: true,
        edit: true,
      },
    },
    billing,
  )
  const editedDays = dayList(await readAuditView(dateCase.thoughtId, billing))
  withReason.checks.push({
    name: 'date back to the captured day',
    ok: editedDays === originalDays,
    expected: originalDays,
    actual: editedDays,
  })
  withReason.notes.push(
    `stored dates: as captured ${originalDays}; injected (one day late) ${injectedDays}; after the vote ${editedDays}`,
  )
  voteGroups.push(withReason)

  const nothingCase = need('clean_weekday_de')
  const nothingBefore = await withEvalDb(
    TENANT,
    () => snapshotStoredData({ userId: TENANT, thoughtId: nothingCase.thoughtId }),
    billing,
  )
  const nothing = await castVote(
    {
      title:
        'thumbs down with a reason on clean_weekday_de (place capture): the stored data is already right, so nothing changes',
      ...nothingCase,
      verdict: 'down',
      place: 'capture',
      reason: NOTHING_CHANGES_REASON,
      reportChange: true,
      expected: {
        verdict: 'down',
        votedOn: 'capture',
        reasonKind: undefined,
        reasonStored: true,
        edit: false,
      },
    },
    billing,
  )
  nothing.notes.push(`Jev labelled the reason ${nothing.stored.reasonKind}`)
  const nothingAfter = await withEvalDb(
    TENANT,
    () => snapshotStoredData({ userId: TENANT, thoughtId: nothingCase.thoughtId }),
    billing,
  )
  {
    const was = JSON.parse(nothingBefore) as Record<string, unknown>
    const now = JSON.parse(nothingAfter) as Record<string, unknown>
    for (const key of ['rawText', 'storedText'] as const) {
      nothing.checks.push({
        name: `${key} untouched`,
        ok: was[key] === now[key],
        expected: String(was[key]),
        actual: String(now[key]),
      })
    }
  }
  if (nothingAfter !== nothingBefore) {
    // made-up fixture data only: show which fields of the stored snapshot moved
    const was = JSON.parse(nothingBefore) as Record<string, unknown>
    const now = JSON.parse(nothingAfter) as Record<string, unknown>
    for (const key of Object.keys(now)) {
      if (JSON.stringify(was[key]) !== JSON.stringify(now[key])) {
        nothing.notes.push(
          `snapshot field ${key}: ${JSON.stringify(was[key])} -> ${JSON.stringify(now[key])}`,
        )
      }
    }
  }
  voteGroups.push(nothing)

  const wordingCase = need('changed_wording_de')
  const wordingBefore = JSON.parse(
    await withEvalDb(
      TENANT,
      () => snapshotStoredData({ userId: TENANT, thoughtId: wordingCase.thoughtId }),
      billing,
    ),
  ) as Record<string, unknown>
  const wording = await castVote(
    {
      title:
        'thumbs down with a reason on changed_wording_de (place mesh): a wording complaint is the one reason that edits the text (reported, not asserted)',
      ...wordingCase,
      reportChange: true,
      verdict: 'down',
      place: 'mesh',
      reason: WORDING_REASON,
      expected: {
        verdict: 'down',
        votedOn: 'mesh',
        reasonKind: undefined,
        reasonStored: true,
        edit: true,
      },
    },
    billing,
  )
  const wordingAfter = JSON.parse(
    await withEvalDb(
      TENANT,
      () => snapshotStoredData({ userId: TENANT, thoughtId: wordingCase.thoughtId }),
      billing,
    ),
  ) as Record<string, unknown>
  wording.notes.push(
    `Jev labelled the reason ${wording.stored.reasonKind}`,
    `rawText: ${JSON.stringify(wordingBefore.rawText)} -> ${JSON.stringify(wordingAfter.rawText)}`,
    `storedText: ${JSON.stringify(wordingBefore.storedText)} -> ${JSON.stringify(wordingAfter.storedText)}`,
  )
  voteGroups.push(wording)

  const splitCase = need('clean_split_en')
  const familyBefore = await withEvalDb(
    TENANT,
    () => readSplitFamily({ userId: TENANT, thoughtId: splitCase.thoughtId }),
    billing,
  )
  const splitChecks: Check[] = []
  const splitNotes: string[] = []
  let splitVote: Awaited<ReturnType<typeof castVote>> | null = null
  if (familyBefore === null || familyBefore.children.length === 0) {
    splitChecks.push({
      name: 'setup: the capture was split',
      ok: false,
      expected: 'children',
      actual: 'none',
    })
  } else {
    const oldIds = familyBefore.children.map((c) => c.id)
    splitVote = await castVote(
      {
        title:
          'thumbs down with a reason on a child of clean_split_en (place mesh): the parent is split again',
        thoughtId: oldIds[0],
        capturedAt: splitCase.capturedAt,
        verdict: 'down',
        place: 'mesh',
        reason: SPLIT_REASON,
        expected: {
          verdict: 'down',
          votedOn: 'mesh',
          reasonKind: 'split_wrong',
          reasonStored: true,
          edit: true,
        },
      },
      billing,
    )
    // the new children are queued for enrichment; let them finish so their reviews exist
    await withEvalDb(TENANT, () => processCaptureEnrichQueue(TENANT, { concurrency: 1 }), {
      ...billing,
      clock: splitCase.capturedAt,
    })
    const familyAfter = await withEvalDb(
      TENANT,
      () => readSplitFamily({ userId: TENANT, thoughtId: splitCase.thoughtId }),
      billing,
    )
    // once the capture is one thought again the parent has no split marker, so the family reads
    // as empty: read the old children's status straight from their rows
    const oldStates = await withEvalDb(
      TENANT,
      async (db) =>
        db
          .select({ id: thought.id, lifecycle: thought.lifecycleStatus })
          .from(thought)
          .where(inArray(thought.id, oldIds)),
      billing,
    )
    splitChecks.push({
      name: 'old children archived, not deleted',
      ok: oldStates.length === oldIds.length && oldStates.every((r) => r.lifecycle === 'archived'),
      expected: `${oldIds.length} stored, all archived`,
      actual: `${oldStates.length} stored, ${oldStates.filter((r) => r.lifecycle === 'archived').length} archived`,
    })
    splitChecks.push({
      name: 'the new split has fewer pieces',
      ok: (familyAfter?.pieces.length ?? 0) < familyBefore.pieces.length,
      expected: `< ${familyBefore.pieces.length}`,
      actual: String(familyAfter?.pieces.length ?? 0),
    })
    splitNotes.push(
      `pieces before: ${familyBefore.pieces.map((p) => `"${p}"`).join(', ')}`,
      `pieces after: ${familyAfter && familyAfter.pieces.length > 0 ? familyAfter.pieces.map((p) => `"${p}"`).join(', ') : 'none (kept as one thought)'}`,
      `children after: ${familyAfter?.children.map((c) => c.lifecycleStatus).join(', ') ?? 'none'}`,
    )
  }
  voteGroups.push({
    title: splitVote?.title ?? 'split_wrong vote on clean_split_en',
    checks: [...(splitVote?.checks ?? []), ...splitChecks],
    notes: [...(splitVote?.notes ?? []), ...splitNotes],
  })

  const revoteCase = need('clean_person_place_en')
  const first = await castVote(
    {
      title: 'first vote on clean_person_place_en: thumbs down, empty reason (place mesh)',
      ...revoteCase,
      verdict: 'down',
      place: 'mesh',
      reason: '',
      expected: { verdict: 'down', votedOn: 'mesh', ...noReason },
    },
    billing,
  )
  await sleep(50)
  const second = await castVote(
    {
      title: 're-vote on clean_person_place_en: thumbs up replaces it (place capture)',
      ...revoteCase,
      verdict: 'up',
      place: 'capture',
      expected: { verdict: 'up', votedOn: 'capture', ...noReason },
    },
    billing,
  )
  const replaced: Check = {
    name: 'voted_at moved forward',
    ok:
      first.stored.votedAt !== null &&
      second.stored.votedAt !== null &&
      second.stored.votedAt.getTime() > first.stored.votedAt.getTime(),
    expected: 'later',
    actual:
      first.stored.votedAt && second.stored.votedAt
        ? second.stored.votedAt.getTime() > first.stored.votedAt.getTime()
          ? 'later'
          : 'not later'
        : 'missing',
  }
  voteGroups.push({
    title: second.title,
    checks: [
      ...first.checks.map((c) => ({ ...c, name: `first vote ${c.name}` })),
      ...second.checks,
      replaced,
    ],
    notes: [],
  })

  // --- operator counts ---
  await drainUserJobQueue({ userId: TENANT, limit: 50 })
  const qualityAfter = await loadCaptureQuality({ includeHarness: true })
  const reviews = await countReviews(billing)
  const finals = [
    up,
    emptyDown,
    withReason,
    nothing,
    wording,
    second,
    ...(splitVote ? [splitVote] : []),
  ].map((v) => v.stored)
  const deltas = qualityDeltaChecks(
    qualityBefore,
    qualityAfter,
    expectedQualityDeltas(reviews, finals),
  )
  const quality = JSON.stringify(qualityAfter)
  const leaked = cases.filter((c) => quality.includes(c.text))
  notes.push(
    leaked.length === 0
      ? 'the loadCaptureQuality result holds none of the capture texts'
      : `the loadCaptureQuality result CONTAINS the text of ${leaked.length} capture(s)`,
  )
  if (leaked.length > 0) {
    deltas.push({
      name: 'result holds no capture text',
      ok: false,
      expected: '0',
      actual: String(leaked.length),
    })
  }

  // Clear any audit jobs still queued for the tenant, then read the spend.
  await drainUserJobQueue({ userId: TENANT, limit: 50 })
  let totalUsd: string | null = null
  try {
    const cost = await aggregateRunCost({
      tenantUserIds: [TENANT],
      from: new Date(0),
      to: new Date('2999-12-31T00:00:00Z'),
    })
    totalUsd = cost.totalUsd
  } catch (err) {
    notes.push(`the cost could not be read: ${err instanceof Error ? err.message : String(err)}`)
  }

  const input = {
    cases: runs.map((r) => r.row),
    voteGroups,
    deltas,
    totalUsd,
    notes,
  }
  console.log(formatVerifyReport(input))
  return verifyExitCode(input)
}
