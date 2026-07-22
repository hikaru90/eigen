import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type GraphScaleLiveMetrics = {
  thoughts: number
  entities: number
  edges: number
  communities: number
  projects: number
}

export type GraphScaleLiveStatus = 'starting' | 'seeding' | 'measuring' | 'finished' | 'failed'

export type GraphScaleLiveIngest = {
  thoughtId: string
  index: number
  ok: boolean
  enriched: boolean
  entityCount: number
  hasEmbedding: boolean
  error?: string
}

export type GraphScaleLiveState = {
  runId: string
  status: GraphScaleLiveStatus
  corpusUserId: string | null
  n: number | null
  seedQueued: number
  seedEnrichTotal: number
  seedEnriched: number
  graph: GraphScaleLiveMetrics
  lastIngest: GraphScaleLiveIngest | null
  enrichPhase: string | null
  label: string
  updatedAt: string
  error?: string
}

const LIVE_STATE_PATH = join(process.cwd(), 'evals/graph-scale/runs/live.json')

function emptyGraphScaleLiveMetrics(): GraphScaleLiveMetrics {
  return { thoughts: 0, entities: 0, edges: 0, communities: 0, projects: 0 }
}

export function graphScaleLiveStatePath(): string {
  return LIVE_STATE_PATH
}

export function readGraphScaleLiveState(): GraphScaleLiveState | null {
  try {
    const raw = readFileSync(LIVE_STATE_PATH, 'utf8')
    return JSON.parse(raw) as GraphScaleLiveState
  } catch {
    return null
  }
}

export function publishGraphScaleLiveState(state: GraphScaleLiveState): void {
  mkdirSync(join(process.cwd(), 'evals/graph-scale/runs'), { recursive: true })
  writeFileSync(LIVE_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

export function initialGraphScaleLiveState(input: {
  runId: string
  label?: string
}): GraphScaleLiveState {
  return {
    runId: input.runId,
    status: 'starting',
    corpusUserId: null,
    n: null,
    seedQueued: 0,
    seedEnrichTotal: 0,
    seedEnriched: 0,
    graph: emptyGraphScaleLiveMetrics(),
    lastIngest: null,
    enrichPhase: null,
    label: input.label ?? 'starting',
    updatedAt: new Date().toISOString(),
  }
}
