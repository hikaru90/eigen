/** Client-safe capture confirmation preview types (mirrors server interpret shape). */

export type CapturePreviewEntity = {
  surface: string
  entityType: string
  confidence: number
}

export type CapturePreviewCategory = {
  key: string
  confidence: number
  alternatives: Array<{ key: string; confidence: number }>
  /** Set when the primary key was invalid and a valid alternative was promoted. */
  repairedFrom?: string
}

export type CapturePreviewBundle = {
  interpretedText: string
  category: CapturePreviewCategory
  entities: CapturePreviewEntity[]
  /** LLM judge: true when interpretation changes meaning/entities beyond trivial cleanup. */
  deviatesFromVerbatim: boolean
}

export type CaptureInterpretStatus = 'ingested' | 'awaiting_confirmation'
