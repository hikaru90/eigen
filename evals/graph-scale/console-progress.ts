import type { GraphScaleTrack } from './types'

const WEIGHTS = {
  seed: 100,
  capture: 8,
  qaQuery: 3,
  consolidation: 15,
} as const

/** Queue is fast; enrich dominates seed wall time. */
const SEED_QUEUE_FRACTION = 0.05
const SEED_ENRICH_FRACTION = 0.95

const MIN_PRINT_INTERVAL_MS = 1500

function formatEta(seconds: number): string {
  if (seconds <= 0) return '0s'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m`
  const hours = Math.floor(seconds / 3600)
  const mins = Math.round((seconds % 3600) / 60)
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

function useInlineProgress(): boolean {
  return process.stderr.isTTY === true && process.env.GRAPH_SCALE_INLINE_PROGRESS === '1'
}

export type GraphScaleProgressSnapshot = {
  pct: number
  etaSec: number
  label: string
}

export class GraphScaleConsoleProgress {
  private readonly startedAt = Date.now()
  private doneWeight = 0
  private readonly totalWeight: number
  private phaseLabel = 'starting'
  private seedQueuePartial = 0
  private seedEnrichPartial = 0
  private lastPrintedPct = -1
  private lastPrintAt = 0
  private lastPrintedLabel = ''

  constructor(input: { sizes: number[]; tracks: ReadonlySet<GraphScaleTrack> }) {
    let total = 0
    for (const _n of input.sizes) {
      total += WEIGHTS.seed
      if (input.tracks.has('capture')) total += WEIGHTS.capture
      if (input.tracks.has('qa')) total += WEIGHTS.qaQuery * 5
      if (input.tracks.has('consolidation')) total += WEIGHTS.consolidation
    }
    this.totalWeight = Math.max(1, total)
  }

  private seedPartialWeight(): number {
    return (
      (this.seedQueuePartial * SEED_QUEUE_FRACTION +
        this.seedEnrichPartial * SEED_ENRICH_FRACTION) *
      WEIGHTS.seed
    )
  }

  snapshot(): GraphScaleProgressSnapshot {
    const weight = this.doneWeight + this.seedPartialWeight()
    const pct = Math.min(100, Math.round((weight / this.totalWeight) * 100))
    const elapsedSec = (Date.now() - this.startedAt) / 1000
    const remainingWeight = this.totalWeight - weight
    const etaSec =
      weight > 0 && pct < 100 && remainingWeight > 0
        ? Math.max(1, Math.round((elapsedSec / weight) * remainingWeight))
        : 0
    return { pct, etaSec, label: this.phaseLabel }
  }

  report(
    label: string,
    opts?: {
      seedQueued?: number
      seedTotal?: number
      seedEnriched?: number
      seedEnrichTotal?: number
      completeSeed?: boolean
      bump?: keyof typeof WEIGHTS
      force?: boolean
    },
  ): GraphScaleProgressSnapshot {
    if (opts?.completeSeed) {
      this.doneWeight += WEIGHTS.seed
      this.seedQueuePartial = 0
      this.seedEnrichPartial = 0
    } else if (
      opts?.seedEnriched !== undefined &&
      opts.seedEnrichTotal &&
      opts.seedEnrichTotal > 0
    ) {
      this.seedQueuePartial = 1
      this.seedEnrichPartial = opts.seedEnriched / opts.seedEnrichTotal
    } else if (opts?.seedQueued !== undefined && opts.seedTotal && opts.seedTotal > 0) {
      this.seedQueuePartial = opts.seedQueued / opts.seedTotal
    } else if (opts?.bump) {
      this.doneWeight += WEIGHTS[opts.bump]
      this.seedQueuePartial = 0
      this.seedEnrichPartial = 0
    }
    this.phaseLabel = label
    return this.print(Boolean(opts?.force))
  }

  print(force = false): GraphScaleProgressSnapshot {
    const snap = this.snapshot()
    const now = Date.now()
    const pctChanged = snap.pct !== this.lastPrintedPct
    const labelChanged = snap.label !== this.lastPrintedLabel
    const throttled =
      !force && !pctChanged && !labelChanged && now - this.lastPrintAt < MIN_PRINT_INTERVAL_MS
    if (throttled) return snap

    this.lastPrintedPct = snap.pct
    this.lastPrintedLabel = snap.label
    this.lastPrintAt = now
    const line = `[graph-scale] ${snap.pct}% · ETA ${formatEta(snap.etaSec)} · ${snap.label}`
    if (useInlineProgress()) {
      process.stderr.write(`\r${line.padEnd(96)}`)
    } else {
      console.log(line)
    }
    return snap
  }

  finish(message: string): void {
    this.phaseLabel = 'done'
    this.doneWeight = this.totalWeight
    this.seedQueuePartial = 0
    this.seedEnrichPartial = 0
    if (useInlineProgress()) {
      process.stderr.write('\n')
    }
    console.log(message)
  }
}
