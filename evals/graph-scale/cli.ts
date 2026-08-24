import type { GraphScaleCli, GraphScaleTrack } from './types'
import { resolve } from 'node:path'
import { resolveSeedConcurrency } from '../harness/concurrency'

const DEFAULT_SIZES = [1]
const DEFAULT_TRACKS: GraphScaleTrack[] = ['capture']
const SPEND_CONFIRM_THRESHOLD = 500

function usage(): never {
  console.error(`Usage: npm run graph-scale -- [options]

Operator-owned benchmark: cost and latency vs corpus size (graph growth).

Options:
  --sizes LIST       Comma-separated thought counts (default: 1)
  --tracks LIST      capture,qa,consolidation (default: capture)
  --output PATH      Final JSON report path (default: evals/graph-scale/runs/report-<timestamp>.json);
                     live progress is written line-by-line to the sibling .jsonl file
  --confirm-spend    Required when max --sizes value exceeds ${SPEND_CONFIRM_THRESHOLD}
  --seed-concurrency N  Parallel capture seeding (default: EVAL_SEED_CONCURRENCY or 8)
`)
  process.exit(1)
}

function parseSizes(raw: string | undefined): number[] {
  const source = raw?.trim() || DEFAULT_SIZES.join(',')
  const sizes = source
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const n = Number.parseInt(part, 10)
      if (!Number.isFinite(n) || n < 1) {
        throw new Error(`[graph-scale] invalid size: ${part}`)
      }
      return n
    })
  if (sizes.length === 0) {
    throw new Error('[graph-scale] --sizes must include at least one positive integer')
  }
  return [...new Set(sizes)].sort((a, b) => a - b)
}

function parseTracks(raw: string | undefined): Set<GraphScaleTrack> {
  if (!raw?.trim()) return new Set(DEFAULT_TRACKS)
  const requested = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  const tracks = new Set<GraphScaleTrack>()
  for (const part of requested) {
    if (part !== 'capture' && part !== 'qa' && part !== 'consolidation') {
      throw new Error(`[graph-scale] unknown track: ${part}`)
    }
    tracks.add(part)
  }
  if (tracks.size === 0) {
    throw new Error(
      '[graph-scale] --tracks must include at least one of capture, qa, consolidation',
    )
  }
  return tracks
}

export function parseGraphScaleCli(argv: string[]): GraphScaleCli {
  let sizesRaw: string | undefined
  let tracksRaw: string | undefined
  let outputPath = ''
  let confirmSpend = false
  let seedConcurrency: number | undefined

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--sizes') {
      sizesRaw = argv[++i] ?? usage()
    } else if (arg === '--tracks') {
      tracksRaw = argv[++i] ?? usage()
    } else if (arg === '--output') {
      outputPath = resolve(argv[++i] ?? usage())
    } else if (arg === '--confirm-spend') {
      confirmSpend = true
    } else if (arg === '--seed-concurrency') {
      const raw = argv[++i] ?? usage()
      seedConcurrency = Number.parseInt(raw, 10)
      if (!Number.isFinite(seedConcurrency) || seedConcurrency < 1) usage()
    } else if (arg === '--help' || arg === '-h') {
      usage()
    } else {
      console.error(`[graph-scale] unknown argument: ${arg}`)
      usage()
    }
  }

  const sizes = parseSizes(sizesRaw)
  const maxSize = sizes[sizes.length - 1] ?? 0
  if (maxSize > SPEND_CONFIRM_THRESHOLD && !confirmSpend) {
    throw new Error(
      `[graph-scale] max size ${maxSize} exceeds ${SPEND_CONFIRM_THRESHOLD}; re-run with --confirm-spend`,
    )
  }

  if (!outputPath) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    outputPath = resolve(`evals/graph-scale/runs/report-${stamp}.json`)
  }

  return {
    sizes,
    tracks: parseTracks(tracksRaw),
    outputPath,
    confirmSpend,
    seedConcurrency: resolveSeedConcurrency(seedConcurrency),
  }
}

export { SPEND_CONFIRM_THRESHOLD }
