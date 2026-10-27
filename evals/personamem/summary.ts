import type { FailureRow } from '../public-bench/failures'
import type { RunSummary, SummarySection } from '../public-bench/run-output'
import type { GroupStats, Score } from './score'
import type { AnswerMode, BelowFloor, OptionLetter, RelevanceFloorSetting, Split } from './types'
import { COMPOSE_ANSWER_RELEVANCE_MIN } from '$lib/server/retrieval/rrf-scoring'

const pct = (x: number) => `${(x * 100).toFixed(1)}%`

/** The numeric floor a run applied: the product constant, or the eval-only override. */
export const floorValue = (setting: RelevanceFloorSetting): number =>
  setting === 'product' ? COMPOSE_ANSWER_RELEVANCE_MIN : setting

const describeFloor = (setting: RelevanceFloorSetting): string =>
  setting === 'product'
    ? `product (${COMPOSE_ANSWER_RELEVANCE_MIN})`
    : `${setting} (eval-only override)`

/** `evidence hit` cell: rate and counts; n/a when no question of the group has history evidence. */
function evidenceHitCell(g: GroupStats): string {
  if (g.evidenceQuestions === null) return 'n/a'
  if (g.evidenceHitRate === null) return `n/a (${g.evidenceQuestions} with history evidence)`
  return `${pct(g.evidenceHitRate)} (${g.evidenceHit}/${g.evidenceQuestions})`
}
const signedPct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)} pp`

function breakdown(
  heading: string,
  firstColumn: string,
  groups: Record<string, GroupStats>,
): SummarySection {
  return {
    heading,
    table: {
      columns: [
        firstColumn,
        'n',
        'eigen',
        'no-memory',
        'lift',
        'evidence retrieved',
        'evidence hit',
        'mean context items',
      ],
      rows: Object.entries(groups).map(([key, g]) => [
        key,
        g.n,
        pct(g.eigenAccuracy),
        pct(g.noMemoryAccuracy),
        signedPct(g.lift),
        pct(g.evidenceRetrievedRate),
        evidenceHitCell(g),
        g.meanContextSize.toFixed(1),
      ]),
    },
  }
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6

export const SMOKE_BANNER = 'SMOKE (evidence-only) - not a benchmark score'
export const REHEARSAL_BANNER = 'REHEARSAL - not a score'

const rehearsalLines = (maxHistoryTurns: number) => [
  `--max-history-turns ${maxHistoryTurns}: only the first ${maxHistoryTurns} user turn(s) of each persona's history were ingested to exercise the run's crash and resume machinery cheaply; questions whose evidence was cut off are asked without history evidence. These numbers say nothing about Eigen's accuracy`,
]

export function decisionsInEffect(
  answer: AnswerMode,
  evidenceOnly: boolean,
  relevanceFloor: RelevanceFloorSetting,
): string[] {
  return [
    relevanceFloor === 'product'
      ? `Relevance floor: product (${COMPOSE_ANSWER_RELEVANCE_MIN}) for thoughts, as real users get it`
      : `Relevance floor ${relevanceFloor} for thoughts: an eval-only override of the product floor (${COMPOSE_ANSWER_RELEVANCE_MIN}), set by the harness for harness tenants only; not a product setting`,
    'D1: one chat model (--chat-model) drives enrich, Ask / composeAnswer and the chooser; embeddings stay the pinned platform model',
    evidenceOnly
      ? 'D2/D3 (evidence-only): per question, one capture per evidence user turn (related_conversation_snippet), capturedAt = 2025-01-01T00:00Z + n days in snippet order (query asked one day after the last turn); one tenant per question; the rest of the history is not replayed'
      : 'D2/D3: the persona system message is NOT captured (deviation from long-context baselines, which see it); one capture per user turn, capturedAt = 2025-01-01T00:00Z + n days (query asked one day after the last turn); assistant turns are not captured',
    'D6: strictly incremental enrich per tenant (enrichConcurrency in config); parallelism is across tenants',
    answer === 'ask'
      ? 'Answer (ask): a new Ask session per question receives the bare query only; the chooser sees the full context of every answer_question call Ask made (dated), not the cited subset; without such a call it sees none and the row is flagged askAnsweredWithoutMemory. Ask never stores anything'
      : 'Answer (compose): composeAnswer runs on the bare query; the chooser sees every item Eigen gave its answer model (context), dated, not only the cited ones',
    'Options never reach Eigen; variants eigen (chooser gets that context) and no-memory (chooser gets none) share the same options and chooser',
    ...(evidenceOnly
      ? []
      : [
          'Evidence hit (full history): a question evidence user turns are matched to the history user turns they are quoted from by exact text (data alignment, no similarity); a hit means the chooser context holds at least one item those captures became - the thought, its split children, and notes linked to them. pref_types whose evidence the dataset keeps out of the history have nothing to hit and are left out of the rate (accuracy still counts them)',
        ]),
  ]
}

const clip = (text: string, max = 280) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}...` : flat
}

/** One question of an evidence-only smoke run, as shown to the operator. */
export type SmokeBlock = {
  questionId: string
  query: string
  /** The target preference (data); never shown to Eigen or the chooser. */
  preference: string
  /** The evidence user turns that were replayed. */
  evidenceUserTurns: string[]
  /** normalizedText of the thoughts in the tenant after ingest. */
  stored: { text: string; createdAt: string }[]
  /** What the chooser saw as Eigen's memories. */
  context: { text: string; storedAt: string }[]
  prefType: string
  /** The best thought score the relevance floor dropped (null: nothing dropped). */
  belowFloor: BelowFloor
  /** `--answer ask`: tools Ask used to answer; null in compose mode. */
  askTools: string[] | null
  askAnsweredWithoutMemory: boolean
  correctAnswer: string
  eigenLetter: OptionLetter
  noMemoryLetter: OptionLetter
  correctLetter: OptionLetter
}

const score3 = (x: number | null) => (x === null ? 'none' : x.toFixed(3))

/** Tells "nothing retrieved" from "something just under the floor" from "no candidate at all". */
function retrievalLine(block: SmokeBlock, floor: number): string {
  const { thoughts } = block.belowFloor
  if (block.askAnsweredWithoutMemory) {
    return 'retrieval: not searched (Ask made no answer_question call)'
  }
  const nearMiss = `best candidate under the ${floor} floor: thoughts ${score3(thoughts)}`
  if (block.context.length > 0) {
    return `retrieval: ${block.context.length} item(s) reached the chooser; ${nearMiss}`
  }
  if (thoughts === null) {
    return `retrieval: NOTHING reached the chooser and no candidate fell under the ${floor} floor either (no candidate at all)`
  }
  return `retrieval: NOTHING reached the chooser; ${nearMiss}`
}

function missesSection(blocks: readonly SmokeBlock[]): SummarySection[] {
  const misses = blocks.filter((b) => b.eigenLetter !== b.correctLetter)
  if (misses.length === 0) return []
  return [
    {
      heading: 'Eigen misses (evidence-only)',
      table: {
        columns: [
          'question',
          'pref_type',
          'context items',
          'best under floor: thoughts',
        ],
        rows: misses.map((b) => [
          b.questionId,
          b.prefType,
          b.context.length,
          score3(b.belowFloor.thoughts),
        ]),
      },
    },
  ]
}

function smokeSection(block: SmokeBlock, floor: number): SummarySection {
  const verdict = (letter: OptionLetter) =>
    `${letter} (${letter === block.correctLetter ? 'correct' : 'wrong'})`
  const numbered = (items: string[]) =>
    items.length === 0 ? ['  (none)'] : items.map((t, i) => `  ${i + 1}. ${t}`)
  return {
    heading: `Smoke: ${block.questionId}`,
    lines: [
      `query: ${clip(block.query)}`,
      `preference (data, hidden from Eigen): ${clip(block.preference)}`,
      `evidence turns replayed (${block.evidenceUserTurns.length}):`,
      ...numbered(block.evidenceUserTurns.map((t) => clip(t))),
      `Eigen stored (${block.stored.length}):`,
      ...numbered(block.stored.map((t) => `[${t.createdAt.slice(0, 10)}] ${clip(t.text)}`)),
      ...(block.askTools === null
        ? []
        : [
            `Ask answered with tools: ${block.askTools.length === 0 ? '(none)' : block.askTools.join(', ')}${block.askAnsweredWithoutMemory ? ' - NO answer_question call, chooser got no memory' : ''}`,
          ]),
      retrievalLine(block, floor),
      `context the chooser saw (${block.context.length}):`,
      ...numbered(block.context.map((t) => `[${t.storedAt.slice(0, 10)}] ${clip(t.text)}`)),
      `correct answer: ${block.correctLetter} - ${clip(block.correctAnswer)}`,
      `eigen picked ${verdict(block.eigenLetter)}; no-memory picked ${verdict(block.noMemoryLetter)}`,
    ],
  }
}

export const PAPER_REFERENCES = [
  'Random guessing: 25%',
  'Frontier LLMs, long-context: 37-48% (PersonaMem-v2 paper)',
  'Paper agentic memory system: 55% (PersonaMem-v2 paper)',
]

export function buildSummary(input: {
  runId: string
  chatModel: string
  startedAt: string
  finishedAt: string
  config: Record<string, unknown>
  /** Which PersonaMem-v2 split the questions came from; shown in the title and the config. */
  split: Split
  score: Score
  answerMode: AnswerMode
  evidenceOnly: boolean
  /** One block per question; required (non-empty) with evidenceOnly, ignored otherwise. */
  smoke: readonly SmokeBlock[]
  /** The Q&A relevance floor the run applied (`product` or the eval-only override). */
  relevanceFloor: RelevanceFloorSetting
  /** Run id whose ingest this run answered against; null = this run ingested. */
  reuseIngest: string | null
  /** Ingest spend recorded by this run (ingest.jsonl); 0 captures when ingest was skipped. */
  ingest: { usd: number; captures: number; personas: number }
  wallMsThisProcess: number
  gitSha: string
  gitDirty: boolean
  /** `--max-history-turns`: a rehearsal, never a score. */
  rehearsal?: { maxHistoryTurns: number } | null
}): RunSummary {
  const { score } = input
  if (input.evidenceOnly && input.smoke.length === 0) {
    throw new Error('[personamem] an --evidence-only run needs smoke blocks')
  }
  const answerUsd = score.usd.total
  return {
    bench: 'personamem-v2',
    runId: input.runId,
    title: `${input.rehearsal ? `${REHEARSAL_BANNER} - ` : ''}${input.evidenceOnly ? `${SMOKE_BANNER} - ` : ''}PersonaMem-v2 x Eigen (text, 32k, ${input.split} split) - ${input.chatModel} (ingest capture, answer ${input.answerMode}, floor ${describeFloor(input.relevanceFloor)})`,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    config: {
      ...input.config,
      split: input.split,
      ingest: 'capture',
      answer: input.answerMode,
      evidenceOnly: input.evidenceOnly,
      relevanceFloor: input.relevanceFloor,
      relevanceFloorValue: floorValue(input.relevanceFloor),
      reuseIngest: input.reuseIngest,
      ...(input.rehearsal ? { rehearsalMaxHistoryTurns: input.rehearsal.maxHistoryTurns } : {}),
      chatModel: input.chatModel,
      gitSha: input.gitSha,
      gitDirty: input.gitDirty,
    },
    metrics: {
      complete: true,
      questions: score.questions,
      eigenAccuracy: score.overall.eigenAccuracy,
      noMemoryAccuracy: score.overall.noMemoryAccuracy,
      lift: score.overall.lift,
      evidenceRetrieved: score.overall.evidenceRetrieved,
      evidenceRetrievedRate: score.overall.evidenceRetrievedRate,
      relevanceFloor: input.relevanceFloor,
      relevanceFloorValue: floorValue(input.relevanceFloor),
      meanContextSize: score.overall.meanContextSize,
      evidenceQuestions: score.overall.evidenceQuestions,
      evidenceHit: score.overall.evidenceHit,
      evidenceHitRate: score.overall.evidenceHitRate,
      byPrefType: Object.fromEntries(
        Object.entries(score.byPrefType).map(([prefType, g]) => [
          prefType,
          {
            n: g.n,
            eigenAccuracy: g.eigenAccuracy,
            noMemoryAccuracy: g.noMemoryAccuracy,
            lift: g.lift,
            evidenceRetrievedRate: g.evidenceRetrievedRate,
            meanContextSize: g.meanContextSize,
            evidenceQuestions: g.evidenceQuestions,
            evidenceHitRate: g.evidenceHitRate,
          },
        ]),
      ),
      invalidLetters: 0,
      ingestUsd: round6(input.ingest.usd),
      answerUsd: round6(answerUsd),
      totalUsd: round6(input.ingest.usd + answerUsd),
      wallMsThisProcess: input.wallMsThisProcess,
    },
    sections: [
      ...(input.rehearsal
        ? [{ heading: REHEARSAL_BANNER, lines: rehearsalLines(input.rehearsal.maxHistoryTurns) }]
        : []),
      ...(input.evidenceOnly
        ? [
            {
              heading: SMOKE_BANNER,
              lines: [
                'Per question: only that question evidence user turns were ingested; accuracy below is a diagnostic over a handful of questions, not a PersonaMem-v2 score',
              ],
            },
            ...missesSection(input.smoke),
            ...input.smoke.map((block) => smokeSection(block, floorValue(input.relevanceFloor))),
          ]
        : []),
      {
        heading: 'Overall',
        table: {
          columns: ['variant', 'n', 'correct', 'accuracy'],
          rows: [
            [
              'eigen',
              score.overall.n,
              score.overall.eigenCorrect,
              pct(score.overall.eigenAccuracy),
            ],
            [
              'no-memory',
              score.overall.n,
              score.overall.noMemoryCorrect,
              pct(score.overall.noMemoryAccuracy),
            ],
            ['lift (eigen - no-memory)', score.overall.n, '', signedPct(score.overall.lift)],
            [
              'evidence retrieved (context non-empty)',
              score.overall.n,
              score.overall.evidenceRetrieved,
              pct(score.overall.evidenceRetrievedRate),
            ],
            ...(score.overall.evidenceQuestions === null
              ? []
              : [
                  [
                    'evidence hit (history evidence in chooser context)',
                    score.overall.evidenceQuestions,
                    score.overall.evidenceHit!,
                    score.overall.evidenceHitRate === null
                      ? 'n/a'
                      : pct(score.overall.evidenceHitRate),
                  ],
                ]),
            ['mean context items', score.overall.n, '', score.overall.meanContextSize.toFixed(1)],
          ],
        },
        lines: [
          ...(score.overall.evidenceQuestions === null
            ? []
            : [
                `evidence hit: ${score.overall.evidenceQuestions} of ${score.overall.n} question(s) have evidence in the history; the rest are scored for accuracy but have nothing to hit`,
              ]),
          input.evidenceOnly
            ? 'evidence retrieved: every thought in a question tenant is evidence, so a non-empty chooser context is a retrieval hit'
            : 'evidence retrieved: the share of eigen rows with a non-empty chooser context; with the whole history in the tenant that is not necessarily evidence',
          `captures ingested in this run: ${input.ingest.captures} across ${input.ingest.personas} tenant(s); USD ingest ${round6(input.ingest.usd)} + answer ${round6(answerUsd)}`,
          'invalid letters: 0 (a response outside A-D fails the call; none are stored)',
          input.ingest.personas === 0
            ? `ingest cost is not included: this run reused existing tenants (${input.reuseIngest === null ? '--resume' : `--reuse-ingest ${input.reuseIngest}`})`
            : 'ingest cost covers the personas ingested in this run directory',
        ],
      },
      breakdown('By pref_type', 'pref_type', score.byPrefType),
      breakdown('By updated', 'updated', score.byUpdated),
      breakdown('By who', 'who', score.byWho),
      breakdown('By distance (tokens)', 'distance', score.byDistance),
      {
        heading: 'Decisions in effect',
        lines: [
          ...(input.split === 'val'
            ? [
                'val split: tuning data (personas disjoint from the benchmark split apart from persona 78); never a reported score',
              ]
            : []),
          ...decisionsInEffect(input.answerMode, input.evidenceOnly, input.relevanceFloor),
        ],
      },
      { heading: 'Reference numbers (from the PersonaMem-v2 paper)', lines: PAPER_REFERENCES },
    ],
  }
}

/**
 * The summary of a run that did not finish: every planned question is not answered, a tenant or
 * a question failed, or the run was stopped. No score - a partial run never yields one - but the
 * failures, what is missing and the exact command to continue are all here.
 */
export function buildIncompleteSummary(input: {
  runId: string
  chatModel: string
  startedAt: string
  finishedAt: string
  split: Split
  answerMode: AnswerMode
  questions: { planned: number; answered: number }
  missingQuestions: readonly string[]
  openFailures: readonly FailureRow[]
  stopped: boolean
  resumeCommand: string
  rehearsal: { maxHistoryTurns: number } | null
}): RunSummary {
  const shown = input.missingQuestions.slice(0, 20)
  return {
    bench: 'personamem-v2',
    runId: input.runId,
    title: `INCOMPLETE - ${input.rehearsal ? `${REHEARSAL_BANNER} - ` : ''}PersonaMem-v2 x Eigen (text, 32k, ${input.split} split) - ${input.chatModel} (answer ${input.answerMode})`,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    config: {
      split: input.split,
      answer: input.answerMode,
      chatModel: input.chatModel,
      ...(input.rehearsal ? { rehearsalMaxHistoryTurns: input.rehearsal.maxHistoryTurns } : {}),
    },
    metrics: {
      complete: false,
      stopped: input.stopped,
      questionsPlanned: input.questions.planned,
      questionsAnswered: input.questions.answered,
      questionsMissing: input.missingQuestions.length,
      openFailures: input.openFailures.length,
    },
    sections: [
      {
        heading: 'INCOMPLETE - no score',
        lines: [
          input.stopped
            ? 'The run was stopped by a signal before it finished.'
            : 'The run did not finish: see the failures and the missing questions below.',
          `${input.questions.answered} of ${input.questions.planned} question(s) answered. A partial run never yields a score.`,
          `Continue with: ${input.resumeCommand}`,
        ],
      },
      ...(input.rehearsal
        ? [{ heading: REHEARSAL_BANNER, lines: rehearsalLines(input.rehearsal.maxHistoryTurns) }]
        : []),
      {
        heading: 'Open failures',
        lines:
          input.openFailures.length === 0
            ? ['none recorded']
            : input.openFailures.map(
                (f) =>
                  `${f.at} ${f.tenant}${f.questionId ? ` ${f.questionId}` : ''} [${f.phase}]: ${f.error}`,
              ),
      },
      {
        heading: 'Questions not answered',
        lines: [
          ...shown,
          ...(input.missingQuestions.length > shown.length
            ? [`... and ${input.missingQuestions.length - shown.length} more`]
            : []),
        ],
      },
    ],
  }
}

/** The floor and the two dev-loop metrics, overall and per pref_type, as console lines at the end of a run. */
export function formatScoreLines(score: Score, relevanceFloor: RelevanceFloorSetting): string[] {
  const { overall } = score
  const hit = (g: GroupStats) =>
    g.evidenceQuestions === null
      ? ''
      : g.evidenceHitRate === null
        ? ', evidence hit n/a'
        : `, evidence hit ${pct(g.evidenceHitRate)} (${g.evidenceHit}/${g.evidenceQuestions})`
  return [
    `relevance floor: ${describeFloor(relevanceFloor)}`,
    `eigen ${pct(overall.eigenAccuracy)}, no-memory ${pct(overall.noMemoryAccuracy)}, lift ${signedPct(overall.lift)}; ` +
      `evidence retrieved ${pct(overall.evidenceRetrievedRate)} (${overall.evidenceRetrieved}/${overall.n})${hit(overall)}; mean context ${overall.meanContextSize.toFixed(1)} item(s)`,
    ...Object.entries(score.byPrefType).map(
      ([prefType, g]) =>
        `  ${prefType}: n=${g.n} eigen ${pct(g.eigenAccuracy)}, no-memory ${pct(g.noMemoryAccuracy)}, lift ${signedPct(g.lift)}, evidence retrieved ${pct(g.evidenceRetrievedRate)}${hit(g)}, mean context ${g.meanContextSize.toFixed(1)}`,
    ),
  ]
}
