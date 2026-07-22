import { loadCorpus } from './dataset'
import { checksAfterEdit, checksBeforeEdit } from './qa-checks'
import type { ExpandedEvalEntry, QaCapture } from './qa-types'
import type { EvalQaRecord } from '../../src/lib/eval/qa-store'

/** Expand a Q&A test into capture steps + check + optional retrieval/edit + answer. */
export function expandQa(qa: EvalQaRecord): ExpandedEvalEntry[] {
  return expandQaEntries([qa])
}

function qasHaveEdits(qas: EvalQaRecord[]): boolean {
  return qas.some((qa) => Boolean(qa.edit))
}

function appendCaptureEntries(input: {
  entries: ExpandedEvalEntry[]
  captureByFixture: Map<string, QaCapture>
  corpus: Map<string, { rawText?: string } | undefined>
  goal: string
  startOrdinal: number
}): number {
  let ordinal = input.startOrdinal
  for (const cap of input.captureByFixture.values()) {
    const thought = input.corpus.get(cap.fixtureId)
    const rawText = cap.rawText ?? thought?.rawText
    if (!rawText) {
      throw new Error(`[eval] unknown capture ${cap.fixtureId}`)
    }
    input.entries.push({
      ordinal: ordinal++,
      kind: 'capture',
      fixtureRef: cap.fixtureId,
      inputJson: {
        rawText,
        goal: input.goal,
        ...(cap.createdAt ? { createdAt: cap.createdAt } : {}),
      },
      expectedJson: {},
    })
  }
  return ordinal
}

function expandQaEntriesPhased(
  qas: EvalQaRecord[],
  captureByFixture: Map<string, QaCapture>,
  corpus: Map<string, { rawText?: string } | undefined>,
  goal: string,
): ExpandedEvalEntry[] {
  const entries: ExpandedEvalEntry[] = []
  let ordinal = appendCaptureEntries({
    entries,
    captureByFixture,
    corpus,
    goal,
    startOrdinal: 0,
  })

  for (const qa of qas) {
    const checks = checksBeforeEdit(qa)
    entries.push({
      ordinal: ordinal++,
      kind: 'check',
      fixtureRef: `${qa.id}_check`,
      inputJson: {
        qaId: qa.id,
        checks,
        fixtureIds: qa.captures.map((c) => c.fixtureId),
        parallelWave: 'check',
      },
      expectedJson: {},
    })
  }

  for (const qa of qas) {
    if (!qa.retrievalQuery) continue
    const checks = checksBeforeEdit(qa)
    entries.push({
      ordinal: ordinal++,
      kind: 'retrieval',
      fixtureRef: `${qa.id}_retrieval`,
      inputJson: {
        query: qa.retrievalQuery,
        category: qa.tags.includes('haystack') ? 'entity_relation' : 'hybrid',
        parallelWave: 'retrieval',
      },
      expectedJson: {
        relevant: qa.retrievalRelevant,
        minNdcgAt10: checks.retrieval?.minNdcgAt10 ?? 0.5,
        needleFixtureId: checks.retrieval?.needleFixtureId,
        needleTopK: checks.retrieval?.needleTopK ?? 5,
        requireSalienceBump: checks.learning?.requireSalienceBump ?? false,
        minAccessCount: checks.learning?.minAccessCount,
      },
    })
  }

  for (const qa of qas) {
    entries.push({
      ordinal: ordinal++,
      kind: 'answer',
      fixtureRef: qa.id,
      inputJson: {
        question: qa.question,
        ...(qa.retrievalQuery ? { retrievalQuery: qa.retrievalQuery } : {}),
        parallelWave: 'answer',
      },
      expectedJson: { acceptance: qa.acceptance },
    })
  }

  return entries
}

/** Expand one or more Q&A tests: shared captures (deduped) then per-QA steps. */
export function expandQaEntries(qas: EvalQaRecord[]): ExpandedEvalEntry[] {
  if (qas.length === 0) {
    throw new Error('[eval] at least one Q&A test is required')
  }

  const corpus = new Map(loadCorpus().thoughts.map((t) => [t.id, t]))
  const entries: ExpandedEvalEntry[] = []
  let ordinal = 0

  const captureByFixture = new Map<string, QaCapture>()
  for (const qa of qas) {
    for (const cap of qa.captures) {
      if (!captureByFixture.has(cap.fixtureId)) {
        captureByFixture.set(cap.fixtureId, cap)
      }
    }
  }

  if (captureByFixture.size === 0) {
    throw new Error('[eval] at least one capture is required across selected Q&A tests')
  }

  const goal =
    qas.length === 1
      ? `Answer eval: ${qas[0]!.question}`
      : `Answer eval batch: ${qas.length} questions`

  if (qas.length > 1 && !qasHaveEdits(qas)) {
    return expandQaEntriesPhased(qas, captureByFixture, corpus, goal)
  }

  ordinal = appendCaptureEntries({
    entries,
    captureByFixture,
    corpus,
    goal,
    startOrdinal: ordinal,
  })

  const editedFixtures = new Set<string>()

  for (const qa of qas) {
    const checks = checksBeforeEdit(qa)
    const postEditChecks = checksAfterEdit(qa)

    for (const cap of qa.captures) {
      const rawText = cap.rawText ?? corpus.get(cap.fixtureId)?.rawText
      if (!rawText?.trim() || !editedFixtures.has(cap.fixtureId)) continue
      entries.push({
        ordinal: ordinal++,
        kind: 'edit',
        fixtureRef: `${qa.id}_fixture_reset_${cap.fixtureId}`,
        inputJson: {
          fixtureId: cap.fixtureId,
          newRawText: rawText,
        },
        expectedJson: { fixtureReset: true },
      })
    }

    entries.push({
      ordinal: ordinal++,
      kind: 'check',
      fixtureRef: `${qa.id}_check`,
      inputJson: {
        qaId: qa.id,
        checks,
        fixtureIds: qa.captures.map((c) => c.fixtureId),
      },
      expectedJson: {},
    })

    if (qa.retrievalQuery) {
      entries.push({
        ordinal: ordinal++,
        kind: 'retrieval',
        fixtureRef: `${qa.id}_retrieval`,
        inputJson: {
          query: qa.retrievalQuery,
          category: qa.tags.includes('haystack') ? 'entity_relation' : 'hybrid',
        },
        expectedJson: {
          relevant: qa.retrievalRelevant,
          minNdcgAt10: checks.retrieval?.minNdcgAt10 ?? 0.5,
          needleFixtureId: checks.retrieval?.needleFixtureId,
          needleTopK: checks.retrieval?.needleTopK ?? 5,
          requireSalienceBump: checks.learning?.requireSalienceBump ?? false,
          minAccessCount: checks.learning?.minAccessCount,
        },
      })
    }

    if (qa.edit) {
      entries.push({
        ordinal: ordinal++,
        kind: 'edit',
        fixtureRef: `${qa.id}_edit`,
        inputJson: {
          fixtureId: qa.edit.fixtureId,
          newRawText: qa.edit.newRawText,
        },
        expectedJson: {},
      })

      if (postEditChecks) {
        entries.push({
          ordinal: ordinal++,
          kind: 'check',
          fixtureRef: `${qa.id}_post_edit_check`,
          inputJson: {
            qaId: qa.id,
            checks: postEditChecks,
            fixtureIds: qa.captures.map((c) => c.fixtureId),
          },
          expectedJson: {},
        })
      }
    }

    entries.push({
      ordinal: ordinal++,
      kind: 'answer',
      fixtureRef: qa.id,
      inputJson: {
        question: qa.question,
        ...(qa.retrievalQuery ? { retrievalQuery: qa.retrievalQuery } : {}),
      },
      expectedJson: { acceptance: qa.acceptance },
    })

    if (qa.edit) {
      editedFixtures.add(qa.edit.fixtureId)
    }
  }

  return entries
}

export function normalizeCaptures(raw: unknown): QaCapture[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => ({
      fixtureId: String(item.fixtureId ?? '').trim(),
      rawText: typeof item.rawText === 'string' ? item.rawText : undefined,
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : undefined,
    }))
    .filter((cap) => cap.fixtureId.length > 0 || Boolean(cap.rawText?.trim()))
}
