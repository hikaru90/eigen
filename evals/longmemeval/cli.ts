import type { LongMemEvalRunCli } from './types'
import { resolve } from 'node:path'
import { resolveLongMemEvalRoot } from './paths'

const DEFAULT_DATASET = resolve(resolveLongMemEvalRoot(), 'data/longmemeval_oracle.json')

const DEFAULT_OUTPUT_DIR = resolve(resolveLongMemEvalRoot(), 'runs')

function usage(): never {
  console.error(`Usage: npm run eval:longmemeval -- [options]

Options:
  --dataset PATH     Benchmark JSON (default: longmemeval/data/longmemeval_oracle.json)
  --output PATH      Hypothesis JSONL output path (default: longmemeval/runs/eigen-<timestamp>.jsonl)
  --limit N          Process at most N instances (after --offset)
  --offset N         Skip the first N instances
  --resume           Skip question_ids already present in --output
  --score-only       Skip generation; only run evaluate_qa.py on --output
  --no-eval          Skip longmemeval/src/evaluation/evaluate_qa.py after generation
  --eval-model NAME  Judge model for evaluate_qa.py (default: gpt-4o; e.g. gpt-4o-mini)
  --granularity MODE  session | turn | user-turn (default: user-turn)
`)
  process.exit(1)
}

export function parseLongMemEvalCli(argv: string[]): LongMemEvalRunCli {
  let datasetPath = DEFAULT_DATASET
  let outputPath = ''
  let limit: number | null = null
  let offset = 0
  let resume = false
  let runEval = true
  let scoreOnly = false
  let evalMetricModel = 'gpt-4o'
  let granularity: LongMemEvalRunCli['granularity'] = 'user-turn'

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dataset') {
      datasetPath = resolve(argv[++i] ?? usage())
    } else if (arg === '--output') {
      outputPath = resolve(argv[++i] ?? usage())
    } else if (arg === '--limit') {
      const parsed = Number(argv[++i])
      if (!Number.isFinite(parsed) || parsed < 1) usage()
      limit = parsed
    } else if (arg === '--offset') {
      const parsed = Number(argv[++i])
      if (!Number.isFinite(parsed) || parsed < 0) usage()
      offset = parsed
    } else if (arg === '--resume') {
      resume = true
    } else if (arg === '--score-only') {
      scoreOnly = true
      runEval = true
    } else if (arg === '--no-eval') {
      runEval = false
    } else if (arg === '--eval-model') {
      evalMetricModel = argv[++i] ?? usage()
    } else if (arg === '--granularity') {
      const mode = argv[++i] ?? usage()
      if (mode !== 'session' && mode !== 'turn' && mode !== 'user-turn') usage()
      granularity = mode
    } else if (arg === '--help' || arg === '-h') {
      usage()
    } else {
      console.error(`Unknown argument: ${arg}`)
      usage()
    }
  }

  if (scoreOnly && !outputPath) {
    console.error('--score-only requires --output PATH to an existing hypothesis JSONL')
    usage()
  }

  if (!outputPath) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    outputPath = resolve(DEFAULT_OUTPUT_DIR, `eigen-${stamp}.jsonl`)
  }

  return {
    datasetPath,
    outputPath,
    limit,
    offset,
    resume,
    runEval,
    scoreOnly,
    evalMetricModel,
    granularity,
  }
}
