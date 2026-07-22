import type { CaptureAttachedFile } from '$lib/capture/capture-result-types'

export type GraphThoughtEditorStored = {
  id: string
  rawText: string
  normalizedText: string
  category: string
  author?: 'user' | 'agent'
  authorLabel?: string | null
  attachedFiles?: CaptureAttachedFile[]
}

export type GraphEntityEditorStored = {
  id: string
  label: string
  entityType: string
  canonicalKey: string
}

export type EntityCaptureRow = {
  id: string
  rawText: string
  normalizedText: string
  category: string
  author?: 'user' | 'agent'
  authorLabel?: string | null
  metadata?: Record<string, unknown> | null
  createdAt: string
  attachedFiles?: CaptureAttachedFile[]
}
