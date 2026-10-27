/**
 * What `npm run capture-review:smoke` prints: per capture (split children included) the stored
 * text, category, review status and score, the review parts and the audit input, then totals.
 * Pure formatting of data the live runner has already read; it makes no calls. Printing the texts
 * is fine here: they are the operator's own fixture captures, in the operator's terminal.
 */

export type SmokePartRow = {
  part: string
  ref: string
  engine: string
  label: string
  probability: number
}

/** The audit input as the audit job built it (names, dates with day and detail, pieces). */
export type SmokeAuditView = {
  names: Array<{ ref: string; surface: string }>
  dates: Array<{ ref: string; event: string; day: string | null; detail: string | null }>
  pieces: Array<{ ref: string; text: string }>
}

export type SmokeReviewRow = {
  status: string
  score: number | null
  auditError: string | null
  parts: SmokePartRow[]
}

export type SmokeThoughtResult = {
  thoughtId: string
  /** True for a thought a capture was split into; false for the capture itself. */
  splitChild: boolean
  /** The stored (normalized) text. */
  text: string
  category: string
  enrichQueueStatus: string | null
  enrichQueueError: string | null
  review: SmokeReviewRow | null
  audit: SmokeAuditView | null
  /** Why the audit input could not be rebuilt (e.g. a rule the formatter cannot express); else null. */
  auditInputError: string | null
}

/** One fixture capture: the thought it became first, its split children after. */
export type SmokeCaptureResult = {
  /** 1-based position in the fixture. */
  index: number
  text: string
  capturedAt: string
  thoughts: SmokeThoughtResult[]
}

export type SmokeTotals = {
  captures: number
  thoughts: number
  splitChildren: number
  reviews: number
  scored: number
  pendingAudit: number
  auditFailed: number
  withoutReview: number
  minScore: number | null
  medianScore: number | null
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export function smokeTotals(captures: SmokeCaptureResult[]): SmokeTotals {
  const thoughts = captures.flatMap((c) => c.thoughts)
  const reviews = thoughts.flatMap((t) => (t.review ? [t.review] : []))
  const scores = reviews.flatMap((r) =>
    r.status === 'scored' && r.score !== null ? [r.score] : [],
  )
  return {
    captures: captures.length,
    thoughts: thoughts.length,
    splitChildren: thoughts.filter((t) => t.splitChild).length,
    reviews: reviews.length,
    scored: reviews.filter((r) => r.status === 'scored').length,
    pendingAudit: reviews.filter((r) => r.status === 'pending_audit').length,
    auditFailed: reviews.filter((r) => r.status === 'audit_failed').length,
    withoutReview: thoughts.length - reviews.length,
    minScore: scores.length > 0 ? Math.min(...scores) : null,
    medianScore: median(scores),
  }
}

/** 0 when every thought of every capture has a scored review; 1 otherwise (and for an empty run). */
export function smokeExitCode(captures: SmokeCaptureResult[]): 0 | 1 {
  const thoughts = captures.flatMap((c) => c.thoughts)
  if (thoughts.length === 0) return 1
  return thoughts.every((t) => t.review?.status === 'scored') ? 0 : 1
}

/** Left-aligned columns, two spaces apart, rows indented; no trailing spaces. */
export function renderTable(header: string[], rows: string[][], indent: string): string[] {
  const all = [header, ...rows]
  const widths = header.map((_, col) => Math.max(...all.map((row) => row[col].length)))
  return all.map((row) =>
    `${indent}${row.map((cell, col) => cell.padEnd(widths[col])).join('  ')}`.trimEnd(),
  )
}

/**
 * Orders the split children of one capture like the pieces the capture was split into (the audit's
 * p1, p2, ...): by the position of the child's text among the piece texts, exact match; children
 * that match no piece come last, in text order. Identity of strings, not a judgment of meaning.
 */
export function orderSplitChildren<T extends { text: string }>(
  children: T[],
  pieceTexts: string[],
): T[] {
  const position = (child: T): number => {
    const at = pieceTexts.indexOf(child.text.trim())
    return at === -1 ? Number.MAX_SAFE_INTEGER : at
  }
  return [...children].sort((a, b) => position(a) - position(b) || a.text.localeCompare(b.text))
}

const fixed = (n: number): string => n.toFixed(4)
const orDash = (value: string | null): string => value ?? '-'
const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many)

function labelled(label: string, value: string): string {
  return `${label}:`.padEnd(10) + value
}

function listBlock(label: string, entries: string[], indent: string): string[] {
  const head = `${label}:`.padEnd(8)
  if (entries.length === 0) return [`${indent}${head}-`]
  return entries.map((entry, i) => `${indent}${i === 0 ? head : ' '.repeat(head.length)}${entry}`)
}

function auditLines(t: SmokeThoughtResult): string[] {
  const audit = t.audit
  if (audit === null) {
    return [`  audit input: ${t.auditInputError ? `unavailable (${t.auditInputError})` : 'none'}`]
  }
  return [
    '  audit input:',
    ...listBlock(
      'names',
      audit.names.map((n) => `${n.ref} "${n.surface}"`),
      '    ',
    ),
    ...listBlock(
      'dates',
      audit.dates.map(
        (d) => `${d.ref} "${d.event}" · day ${orDash(d.day)} · detail ${orDash(d.detail)}`,
      ),
      '    ',
    ),
    ...listBlock(
      'pieces',
      audit.pieces.map((p) => `${p.ref} "${p.text}"`),
      '    ',
    ),
  ]
}

function reviewLines(t: SmokeThoughtResult): string[] {
  if (t.review === null) {
    const state =
      t.enrichQueueStatus === null
        ? ''
        : ` (enrichment ${t.enrichQueueStatus}${t.enrichQueueError ? `: ${t.enrichQueueError}` : ''})`
    return [`  ${labelled('review', `none${state}`)}`]
  }
  const { status, score, auditError, parts } = t.review
  return [
    `  ${labelled('review', `${status} · score ${score === null ? '-' : fixed(score)}`)}`,
    ...(auditError ? [`  ${labelled('error', auditError)}`] : []),
    ...(parts.length === 0
      ? [`  ${labelled('parts', 'none')}`]
      : [
          '  parts:',
          ...renderTable(
            ['PART', 'REF', 'ENGINE', 'LABEL', 'PROBABILITY'],
            parts.map((p) => [p.part, p.ref, p.engine, p.label, fixed(p.probability)]),
            '    ',
          ),
        ]),
  ]
}

function thoughtLines(capture: SmokeCaptureResult, t: SmokeThoughtResult): string[] {
  const kind = t.splitChild ? 'split child' : 'capture'
  const text = !t.splitChild && t.text === capture.text ? 'same as the capture' : t.text
  return [
    '',
    `thought ${t.thoughtId.slice(0, 8)} (${kind})`,
    `  ${labelled('text', text)}`,
    `  ${labelled('category', t.category)}`,
    ...reviewLines(t),
    ...auditLines(t),
  ]
}

export function formatSmokeReport(captures: SmokeCaptureResult[]): string {
  const lines: string[] = []
  for (const capture of captures) {
    lines.push(
      '',
      `=== Capture ${capture.index} of ${captures.length} · ${capture.capturedAt}`,
      `capture: ${capture.text}`,
    )
    for (const t of capture.thoughts) lines.push(...thoughtLines(capture, t))
  }

  const totals = smokeTotals(captures)
  const children =
    totals.splitChildren === 0
      ? ''
      : ` (${totals.splitChildren} ${plural(totals.splitChildren, 'split child', 'split children')})`
  const notScored = totals.thoughts - totals.scored
  lines.push(
    '',
    '=== Totals',
    `captures: ${totals.captures} · thoughts: ${totals.thoughts}${children}`,
    `reviews:  ${totals.reviews} · scored ${totals.scored} · pending_audit ${totals.pendingAudit} · audit_failed ${totals.auditFailed} · no review ${totals.withoutReview}`,
    totals.minScore === null || totals.medianScore === null
      ? 'score:    n/a (nothing scored)'
      : `score:    min ${fixed(totals.minScore)} · median ${fixed(totals.medianScore)} (over ${totals.scored} scored)`,
    notScored === 0 && totals.thoughts > 0
      ? 'result:   OK · every thought has a scored review'
      : `result:   FAIL · ${notScored} of ${totals.thoughts} ${plural(totals.thoughts, 'thought', 'thoughts')} ${plural(notScored, 'has', 'have')} no scored review`,
    '',
  )
  return lines.join('\n')
}
