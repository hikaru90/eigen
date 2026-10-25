import type { RunSummary, SummarySection } from '../public-bench/run-output'
import type { GroupStats, Score } from './score'
import type { AnswerMode, BelowFloor, OptionLetter, Split } from './types'
import { COMPOSE_ANSWER_RELEVANCE_MIN } from '$lib/server/retrieval/rrf-scoring'

const pct = (x: number) => `${(x * 100).toFixed(1)}%`
const signedPct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)} pp`

function breakdown(
  heading: string,
  firstColumn: string,
  groups: Record<string, GroupStats>,
): SummarySection {
  return {
    heading,
    table: {
      columns: [firstColumn, 'n', 'eigen', 'no-memory', 'lift', 'evidence retrieved'],
      rows: Object.entries(groups).map(([key, g]) => [
        key,
        g.n,
        pct(g.eigenAccuracy),
        pct(g.noMemoryAccuracy),
        signedPct(g.lift),
        pct(g.evidenceRetrievedRate),
      ]),
    },
  }
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6

export const SMOKE_BANNER = 'SMOKE (evidence-only) - not a benchmark score'

export function decisionsInEffect(answer: AnswerMode, evidenceOnly: boolean): string[] {
  return [
    'D1: one chat model (--chat-model) drives enrich, Ask / composeAnswer and the chooser; embeddings stay the pinned platform model',
    evidenceOnly
      ? 'D2/D3 (evidence-only): per question, one capture per evidence user turn (related_conversation_snippet), capturedAt = 2025-01-01T00:00Z + n days in snippet order (query asked one day after the last turn); one tenant per question; the rest of the history is not replayed'
      : 'D2/D3: the persona system message is NOT captured (deviation from long-context baselines, which see it); one capture per user turn, capturedAt = 2025-01-01T00:00Z + n days (query asked one day after the last turn); assistant turns are not captured',
    'D6: strictly incremental enrich per tenant (enrichConcurrency in config); parallelism is across tenants',
    answer === 'ask'
      ? 'Answer (ask): a new Ask session per question receives the bare query only; the chooser sees the full context of every answer_question call Ask made (dated), not the cited subset; without such a call it sees none and the row is flagged askAnsweredWithoutMemory. Ask never stores anything'
      : 'Answer (compose): composeAnswer runs on the bare query; the chooser sees every item Eigen gave its answer model (context), dated, not only the cited ones',
    'Options never reach Eigen; variants eigen (chooser gets that context) and no-memory (chooser gets none) share the same options and chooser',
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
  /** The best candidate scores the relevance floor dropped (null: nothing dropped on that side). */
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
function retrievalLine(block: SmokeBlock): string {
  const floor = COMPOSE_ANSWER_RELEVANCE_MIN
  const { thoughts, notePassages } = block.belowFloor
  if (block.askAnsweredWithoutMemory) {
    return 'retrieval: not searched (Ask made no answer_question call)'
  }
  const nearMiss = `best candidate under the ${floor} floor: thoughts ${score3(thoughts)}, note passages ${score3(notePassages)}`
  if (block.context.length > 0) {
    return `retrieval: ${block.context.length} item(s) reached the chooser; ${nearMiss}`
  }
  if (thoughts === null && notePassages === null) {
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
          'best under floor: note passages',
        ],
        rows: misses.map((b) => [
          b.questionId,
          b.prefType,
          b.context.length,
          score3(b.belowFloor.thoughts),
          score3(b.belowFloor.notePassages),
        ]),
      },
    },
  ]
}

function smokeSection(block: SmokeBlock): SummarySection {
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
      retrievalLine(block),
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
  /** Ingest spend recorded by this run (ingest.jsonl); 0 captures when ingest was skipped. */
  ingest: { usd: number; captures: number; personas: number }
  wallMsThisProcess: number
  gitSha: string
  gitDirty: boolean
}): RunSummary {
  const { score } = input
  if (input.evidenceOnly && input.smoke.length === 0) {
    throw new Error('[personamem] an --evidence-only run needs smoke blocks')
  }
  const answerUsd = score.usd.total
  return {
    bench: 'personamem-v2',
    runId: input.runId,
    title: `${input.evidenceOnly ? `${SMOKE_BANNER} - ` : ''}PersonaMem-v2 x Eigen (text, 32k, ${input.split} split) - ${input.chatModel} (ingest capture, answer ${input.answerMode})`,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    config: {
      ...input.config,
      split: input.split,
      ingest: 'capture',
      answer: input.answerMode,
      evidenceOnly: input.evidenceOnly,
      chatModel: input.chatModel,
      gitSha: input.gitSha,
      gitDirty: input.gitDirty,
    },
    metrics: {
      questions: score.questions,
      eigenAccuracy: score.overall.eigenAccuracy,
      noMemoryAccuracy: score.overall.noMemoryAccuracy,
      lift: score.overall.lift,
      evidenceRetrieved: score.overall.evidenceRetrieved,
      evidenceRetrievedRate: score.overall.evidenceRetrievedRate,
      byPrefType: Object.fromEntries(
        Object.entries(score.byPrefType).map(([prefType, g]) => [
          prefType,
          {
            n: g.n,
            eigenAccuracy: g.eigenAccuracy,
            noMemoryAccuracy: g.noMemoryAccuracy,
            lift: g.lift,
            evidenceRetrievedRate: g.evidenceRetrievedRate,
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
      ...(input.evidenceOnly
        ? [
            {
              heading: SMOKE_BANNER,
              lines: [
                'Per question: only that question evidence user turns were ingested; accuracy below is a diagnostic over a handful of questions, not a PersonaMem-v2 score',
              ],
            },
            ...missesSection(input.smoke),
            ...input.smoke.map(smokeSection),
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
          ],
        },
        lines: [
          input.evidenceOnly
            ? 'evidence retrieved: every thought in a question tenant is evidence, so a non-empty chooser context is a retrieval hit'
            : 'evidence retrieved: the share of eigen rows with a non-empty chooser context; with the whole history in the tenant that is not necessarily evidence',
          `captures ingested in this run: ${input.ingest.captures} across ${input.ingest.personas} tenant(s); USD ingest ${round6(input.ingest.usd)} + answer ${round6(answerUsd)}`,
          'invalid letters: 0 (a response outside A-D fails the call; none are stored)',
          input.ingest.personas === 0
            ? 'ingest cost is not included: this run reused existing tenants (--skip-ingest or --resume)'
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
          ...decisionsInEffect(input.answerMode, input.evidenceOnly),
        ],
      },
      { heading: 'Reference numbers (from the PersonaMem-v2 paper)', lines: PAPER_REFERENCES },
    ],
  }
}

/** The two dev-loop metrics, overall and per pref_type, as console lines at the end of a run. */
export function formatScoreLines(score: Score): string[] {
  const { overall } = score
  return [
    `eigen ${pct(overall.eigenAccuracy)}, no-memory ${pct(overall.noMemoryAccuracy)}, lift ${signedPct(overall.lift)}; ` +
      `evidence retrieved ${pct(overall.evidenceRetrievedRate)} (${overall.evidenceRetrieved}/${overall.n})`,
    ...Object.entries(score.byPrefType).map(
      ([prefType, g]) =>
        `  ${prefType}: n=${g.n} eigen ${pct(g.eigenAccuracy)}, no-memory ${pct(g.noMemoryAccuracy)}, lift ${signedPct(g.lift)}, evidence retrieved ${pct(g.evidenceRetrievedRate)}`,
    ),
  ]
}
