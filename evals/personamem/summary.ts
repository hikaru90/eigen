import type { RunSummary, SummarySection } from '../public-bench/run-output'
import type { GroupStats, Score } from './score'
import type { AskTurnRecord, IngestMode } from './types'

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

const SHARED_DECISIONS = [
  'D1: one chat model (--chat-model) drives ingest, enrich, composeAnswer and the chooser; embeddings stay the pinned platform model',
  'D2: the persona system message of each history is NOT replayed or captured (deviation from long-context baselines, which see it)',
  'D6: strictly incremental enrich per persona (enrichConcurrency in config); parallelism is across personas',
  'Options never reach Eigen: composeAnswer retrieves from the bare query; the chooser sees every item Eigen gave its answer model (context), dated, not only the cited ones',
  'Variants: eigen (chooser gets that context) and no-memory (chooser gets none) share the same options and chooser',
]

export function decisionsInEffect(mode: IngestMode): string[] {
  return [
    SHARED_DECISIONS[0]!,
    SHARED_DECISIONS[1]!,
    mode === 'ask'
      ? 'D3 (ask): every user turn is sent to one Ask chat session per persona under eval clock 2025-01-01T00:00Z + n days (query asked one day after the last turn); Ask decides what to store, assistant turns are not replayed (Ask writes its own replies)'
      : 'D3 (capture): one capture per user turn, capturedAt = 2025-01-01T00:00Z + n days (query asked one day after the last turn); assistant turns are not captured',
    ...SHARED_DECISIONS.slice(2),
  ]
}

type AskPersonaStats = {
  personaId: number
  turns: number
  captures: number
  turnsWithCapture: number
  deletes: number
  thoughtsCreated: number
  clockMismatches: number
  askUsd: number
  enrichUsd: number
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6

function askStats(records: readonly AskTurnRecord[]): {
  personas: AskPersonaStats[]
  total: Omit<AskPersonaStats, 'personaId'>
} {
  const byPersona = new Map<number, AskPersonaStats>()
  for (const r of records) {
    const stats = byPersona.get(r.personaId) ?? {
      personaId: r.personaId,
      turns: 0,
      captures: 0,
      turnsWithCapture: 0,
      deletes: 0,
      thoughtsCreated: 0,
      clockMismatches: 0,
      askUsd: 0,
      enrichUsd: 0,
    }
    stats.turns += 1
    stats.captures += r.captures
    stats.turnsWithCapture += r.captures > 0 ? 1 : 0
    stats.deletes += r.deletes
    stats.thoughtsCreated += r.thoughtsCreated
    stats.clockMismatches += r.clockMismatches
    stats.askUsd += r.askUsd
    stats.enrichUsd += r.enrichUsd
    byPersona.set(r.personaId, stats)
  }
  const personas = [...byPersona.values()].sort((a, b) => a.personaId - b.personaId)
  const total: Omit<AskPersonaStats, 'personaId'> = {
    turns: 0,
    captures: 0,
    turnsWithCapture: 0,
    deletes: 0,
    thoughtsCreated: 0,
    clockMismatches: 0,
    askUsd: 0,
    enrichUsd: 0,
  }
  for (const { personaId: _id, ...p } of personas) {
    for (const key of Object.keys(total) as (keyof typeof total)[]) total[key] += p[key]
  }
  return { personas, total }
}

function askSection(records: readonly AskTurnRecord[]): SummarySection {
  const { personas, total } = askStats(records)
  const row = (label: string | number, s: Omit<AskPersonaStats, 'personaId'>) => [
    label,
    s.turns,
    s.captures,
    s.turnsWithCapture,
    s.deletes,
    s.thoughtsCreated,
    s.clockMismatches,
    round6(s.askUsd),
    round6(s.enrichUsd),
  ]
  return {
    heading: 'Ask ingest',
    lines: [
      'user turns replayed = Ask messages sent; captures / deletes = successful capture_thought / delete_thought(s_by_request) tool calls Ask made',
      'thoughts created = new thought rows per turn (includes split / fan-out children); a turn with no capture is normal',
      'clock mismatches = created thoughts whose stored createdAt differs from the turn clock (Ask may pass its own captured_at; reported, not corrected)',
      "ask USD = the Ask turn itself (agent loop, capture tool, answer_question); enrich USD = draining and awaiting enrichment of that turn's thoughts",
    ],
    table: {
      columns: [
        'persona',
        'user turns replayed',
        'captures',
        'turns with a capture',
        'deletes',
        'thoughts created',
        'clock mismatches',
        'ask USD',
        'enrich USD',
      ],
      rows: [...personas.map((p) => row(p.personaId, p)), row('total', total)],
    },
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
  score: Score
  ingestMode: IngestMode
  /** Every ask-turns.jsonl record (empty in capture mode, required in ask mode). */
  askTurns: readonly AskTurnRecord[]
  /** Ingest spend recorded by this run (ingest.jsonl); 0 captures when ingest was skipped. */
  ingest: { usd: number; captures: number; personas: number }
  wallMsThisProcess: number
  gitSha: string
  gitDirty: boolean
}): RunSummary {
  const { score } = input
  if (input.ingestMode === 'ask' && input.askTurns.length === 0) {
    throw new Error('[personamem] ask-turns.jsonl holds no turns for an --ingest ask run')
  }
  const ask = input.ingestMode === 'ask' ? askStats(input.askTurns).total : null
  const answerUsd = score.usd.total
  return {
    bench: 'personamem-v2',
    runId: input.runId,
    title: `PersonaMem-v2 x Eigen (text, 32k) - ${input.chatModel}`,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    config: {
      ...input.config,
      ingest: input.ingestMode,
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
      ...(ask
        ? {
            askTurns: ask.turns,
            askCaptures: ask.captures,
            askTurnsWithCapture: ask.turnsWithCapture,
            askDeletes: ask.deletes,
            askClockMismatches: ask.clockMismatches,
            askTurnUsd: round6(ask.askUsd),
            askEnrichUsd: round6(ask.enrichUsd),
          }
        : {}),
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
          `${input.ingestMode === 'ask' ? 'captures Ask made' : 'captures ingested'} in this run: ${input.ingest.captures} across ${input.ingest.personas} persona(s); USD ingest ${round6(input.ingest.usd)} + answer ${round6(answerUsd)}`,
          'invalid letters: 0 (a response outside A-D fails the call; none are stored)',
          input.ingest.personas === 0
            ? 'ingest cost is not included: this run reused existing tenants (--skip-ingest or --resume)'
            : 'ingest cost covers the personas ingested in this run directory',
        ],
      },
      ...(ask ? [askSection(input.askTurns)] : []),
      breakdown('By pref_type', 'pref_type', score.byPrefType),
      breakdown('By updated', 'updated', score.byUpdated),
      breakdown('By who', 'who', score.byWho),
      breakdown('By distance (tokens)', 'distance', score.byDistance),
      { heading: 'Decisions in effect', lines: decisionsInEffect(input.ingestMode) },
      { heading: 'Reference numbers (from the PersonaMem-v2 paper)', lines: PAPER_REFERENCES },
    ],
  }
}
