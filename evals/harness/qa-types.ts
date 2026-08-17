export type QaCapture = {
  fixtureId: string
  rawText?: string
  /** Optional ISO-8601 for temporal eval captures. */
  createdAt?: string
}

export type GradedRelevance = { id: string; grade: 0 | 1 | 2 | 3 }

export type QaRetrievalRelevant = GradedRelevance

export type QaEditStep = {
  fixtureId: string
  newRawText: string
}

/** Expected thought-to-thought link (fixture ids). */
export type QaRelationCheck = {
  sourceFixtureId: string
  targetFixtureId: string
  /** Substring match on relation_type when set. */
  typeIncludes?: string
}

/** Per-fixture entity expectations. */
export type QaEntityCheck = {
  fixtureId: string
  minCount?: number
  maxCount?: number
  /** At least one mention surface must contain each substring (case-insensitive). */
  surfacesContaining?: string[]
}

/** Per-fixture temporal event expectations (Postgres temporal_event ledger). */
export type QaTemporalCheck = {
  fixtureId: string
  minCount?: number
  /** At least one event kind must match when set. */
  kinds?: string[]
}

export type QaChecks = {
  /** AGE Thought nodes must exist for these fixtures. */
  graph?: { requireThoughtNodes?: string[] }
  /** Postgres thought_relation rows between fixture pairs. */
  relations?: QaRelationCheck[]
  /** Entity resolution log counts / surfaces per fixture. */
  entities?: QaEntityCheck[]
  /** Temporal_event rows per fixture. */
  temporal?: QaTemporalCheck[]
  /** Category in active ontology; optional profile growth. */
  ontology?: {
    requireActiveCategories?: string[]
    requireProfileGuidance?: boolean
    minEvaluatedThoughtCount?: number
  }
  /** Enrichment and optional surface checks. */
  extraction?: {
    requireEnriched?: string[]
    requireCues?: string[]
  }
  /** Embedding vector + lexical surface. */
  embedding?: {
    requireVector?: string[]
    minLexicalLength?: number
    expectedDimensions?: number
  }
  /** Passed through to retrieval entry (not run in check entry). */
  retrieval?: {
    minNdcgAt10?: number
    needleFixtureId?: string
    needleTopK?: number
  }
  /** Post-answer / post-retrieval signals (validated in retrieval or answer entry). */
  learning?: {
    requireSalienceBump?: boolean
    minAccessCount?: number
  }
}

export type ExpandedEvalEntry = {
  ordinal: number
  kind: 'capture' | 'check' | 'retrieval' | 'answer' | 'edit'
  fixtureRef: string
  inputJson: Record<string, unknown>
  expectedJson: Record<string, unknown>
}

export type EvalRetrievalQuery = {
  id: string
  category: 'semantic_paraphrase' | 'entity_relation' | 'hybrid' | 'direct_recall'
  text: string
  relevant: GradedRelevance[]
}

export type CheckAssertionResult = {
  id: string
  label: string
  passed: boolean
  evidence: string
  /** Fixture id when assertion is about a specific captured thought. */
  fixtureId?: string
  /** Short excerpt of stored thought text for eval UI. */
  thoughtPreview?: string
}

export type CheckEntryResult = {
  assertions: CheckAssertionResult[]
  passedCount: number
  failedCount: number
}
