export type IngestPhase =
  | 'ensure_ontology_seeded'
  | 'accounting'
  | 'normalize'
  | 'load_entity_hints'
  | 'classify_category'
  | 'embedding'
  | 'persist_session_encrypt'
  | 'persist_dedup'
  | 'persist_insert'
  | 'graph_anchor'
  | 'content_split'
  | 'enrich_bump_version'
  | 'enrich_entities'
  | 'enrich_metadata'
  | 'enrich_temporal'
  | 'materialize_links'
  | 'enrich_gtd_assignment'
  | 'mark_enriched'
  | 'ontology_eval'
  | 'enrich_relations'
  | 'relations_extract'
  | 'relations_persist'
  | 'load_result'
  | 'enrich_cues'
  | 'enrich_project_detection'
  | 'load_enrichment_context'
  | 'prefetch_enrich_llm'
  | 'persist_classify_embed'

export type IngestPhaseEntry = { phase: IngestPhase; ms: number }

export type IngestTimingReport = {
  phases: IngestPhaseEntry[]
  wallMs: number
}

export type IngestPhaseTimer = {
  time: <T>(phase: IngestPhase, fn: () => Promise<T>) => Promise<T>
  finish: () => IngestTimingReport
}

export function createIngestPhaseTimer(): IngestPhaseTimer {
  const startedAt = Date.now()
  const phases: IngestPhaseEntry[] = []

  return {
    async time<T>(phase: IngestPhase, fn: () => Promise<T>): Promise<T> {
      const phaseStart = Date.now()
      try {
        return await fn()
      } finally {
        phases.push({ phase, ms: Math.max(0, Date.now() - phaseStart) })
      }
    },
    finish() {
      return {
        phases: [...phases],
        wallMs: Math.max(0, Date.now() - startedAt),
      }
    },
  }
}

import { isGraphScaleQuiet } from '$lib/server/observability/graph-scale-quiet'

export function logIngestPhaseTiming(input: {
  userId: string
  thoughtId?: string
  timing: IngestTimingReport
}): void {
  if (isGraphScaleQuiet()) return
  const sorted = [...input.timing.phases].sort((a, b) => b.ms - a.ms)
  console.info('[capture.timing]', {
    userId: input.userId,
    thoughtId: input.thoughtId ?? null,
    wallMs: input.timing.wallMs,
    phaseSumMs: input.timing.phases.reduce((sum, p) => sum + p.ms, 0),
    phases: input.timing.phases,
    slowest: sorted.slice(0, 5).map((p) => `${p.phase}=${p.ms}ms`),
  })
}
