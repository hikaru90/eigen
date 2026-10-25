import type { RunSummary, SummarySection } from '../public-bench/run-output'
import type { GroupStats, Score } from './score'

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
      columns: [firstColumn, 'n', 'eigen', 'no-memory', 'lift'],
      rows: Object.entries(groups).map(([key, g]) => [
        key,
        g.n,
        pct(g.eigenAccuracy),
        pct(g.noMemoryAccuracy),
        signedPct(g.lift),
      ]),
    },
  }
}

export const DECISIONS_IN_EFFECT = [
  'D1: one chat model (--chat-model) drives capture, enrich, composeAnswer and the chooser; embeddings stay the pinned platform model',
  'D2: the persona system message of each history is NOT captured (deviation from long-context baselines, which see it)',
  'D3: one capture per user turn, capturedAt = 2025-01-01T00:00Z + n days (query asked one day after the last turn); assistant turns are not captured',
  'D6: strictly incremental enrich per persona (enrichConcurrency in config); parallelism is across personas',
  'Options never reach Eigen: composeAnswer retrieves from the bare query, the chooser sees only what Eigen surfaced',
  'Variants: eigen (chooser gets Eigen retrieved memories) and no-memory (chooser gets none) share the same options and chooser',
]

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
  score: Score
  /** Ingest spend recorded by this run (ingest.jsonl); 0 captures when ingest was skipped. */
  ingest: { usd: number; captures: number; personas: number }
  wallMsThisProcess: number
  gitSha: string
  gitDirty: boolean
}): RunSummary {
  const { score } = input
  const answerUsd = score.usd.total
  const round6 = (x: number) => Math.round(x * 1e6) / 1e6
  return {
    bench: 'personamem-v2',
    runId: input.runId,
    title: `PersonaMem-v2 x Eigen (text, 32k) - ${input.chatModel}`,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    config: {
      ...input.config,
      chatModel: input.chatModel,
      gitSha: input.gitSha,
      gitDirty: input.gitDirty,
    },
    metrics: {
      questions: score.questions,
      eigenAccuracy: score.overall.eigenAccuracy,
      noMemoryAccuracy: score.overall.noMemoryAccuracy,
      lift: score.overall.lift,
      invalidLetters: 0,
      ingestUsd: round6(input.ingest.usd),
      answerUsd: round6(answerUsd),
      totalUsd: round6(input.ingest.usd + answerUsd),
      wallMsThisProcess: input.wallMsThisProcess,
    },
    sections: [
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
          ],
        },
        lines: [
          `captures ingested by this run: ${input.ingest.captures} across ${input.ingest.personas} persona(s); USD ingest ${round6(input.ingest.usd)} + answer ${round6(answerUsd)}`,
          'invalid letters: 0 (a response outside A-D fails the call; none are stored)',
          input.ingest.captures === 0
            ? 'ingest cost is not included: this run reused existing tenants (--skip-ingest or --resume)'
            : 'ingest cost covers the personas ingested in this run directory',
        ],
      },
      breakdown('By pref_type', 'pref_type', score.byPrefType),
      breakdown('By updated', 'updated', score.byUpdated),
      breakdown('By who', 'who', score.byWho),
      breakdown('By distance (tokens)', 'distance', score.byDistance),
      { heading: 'Decisions in effect', lines: DECISIONS_IN_EFFECT },
      { heading: 'Reference numbers (from the PersonaMem-v2 paper)', lines: PAPER_REFERENCES },
    ],
  }
}
