export type CaptureLinkedEntity = {
  entityId: string
  label: string
  entityType: string
  mentionSurface: string
  decision: string
}

export type CaptureLinkedThought = {
  thoughtId: string
  relationType: string
  preview: string
}

export type CaptureTemporalSummary = {
  id: string
  kind: string
  semanticSummary: string
}

export type CaptureAttachedFile = {
  id: string
  title: string
  preview: string
  updatedAt: string
}

export type CaptureMemoryAuthor = 'user' | 'agent'

export type CaptureRecentThoughtSnippet = {
  id: string
  normalizedText: string
  category: string
  createdAt: string
  author?: CaptureMemoryAuthor
  authorLabel?: string | null
  /** Lifecycle state — capture page uses it for the done/reopen toggle. */
  lifecycleStatus?: 'open' | 'completed' | 'archived'
}

export type CaptureSubmitResult = {
  id: string
  normalizedText: string
  category: string
  metadata: Record<string, unknown>
  cues: string[]
  enrichedAt: string | null
  entities: CaptureLinkedEntity[]
  temporalEvents: CaptureTemporalSummary[]
  linkedThoughts: CaptureLinkedThought[]
  attachedFiles: CaptureAttachedFile[]
  enrichmentComplete: boolean
  gtdProjectLabel: string | null
  gtdIsNextAction: boolean
  /** Tiered ingest queue state (null on legacy rows). */
  queueStatus: 'awaiting_confirmation' | 'pending' | 'processing' | 'complete' | 'failed' | null
  /** Present when queueStatus is failed or after stale recovery. */
  queueError?: string | null
  author?: CaptureMemoryAuthor
  authorLabel?: string | null
  /** Lifecycle state — the capture page reads it for the done/reopen toggle. */
  lifecycleStatus?: 'open' | 'completed' | 'archived'
}
