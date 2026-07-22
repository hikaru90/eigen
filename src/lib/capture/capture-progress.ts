import type { CaptureIngestPhase } from './ingest-phases'
import { CAPTURE_INGEST_PHASE_COPY } from './ingest-phases'
import type { ProgressEvent } from './consume-capture-ndjson'

export function totalPipelineSteps(
  pipeline: Array<CaptureIngestPhase | CaptureIngestPhase[]>,
): number {
  return pipeline.length
}

/** Index of the pipeline slot for the latest progress event (-1 if none). */
export function pipelineStepIndexFromEvent(
  event: ProgressEvent,
  pipeline: Array<CaptureIngestPhase | CaptureIngestPhase[]>,
): number {
  for (let i = 0; i < pipeline.length; i++) {
    const slot = pipeline[i]
    if (event.parallel) {
      if (Array.isArray(slot) && event.phases.some((p) => slot.includes(p))) return i
    } else {
      if (!Array.isArray(slot) && slot === event.phase) return i
      if (Array.isArray(slot) && slot.includes(event.phase)) return i
    }
  }
  return -1
}

export function progressEventLabel(event: ProgressEvent): string {
  if (event.parallel) {
    return event.phases.map((p) => CAPTURE_INGEST_PHASE_COPY[p].title).join(' · ')
  }
  return CAPTURE_INGEST_PHASE_COPY[event.phase].title
}

export type CaptureQueueStatusLine =
  | { kind: 'queued'; waiting: number }
  | { kind: 'starting' }
  | { kind: 'step'; label: string; stepIndex: number }
  | { kind: 'background'; waiting: number }

export function captureQueueStatusLine(input: {
  processing: boolean
  pendingCount: number
  activeEvent: ProgressEvent | null
  pipeline: Array<CaptureIngestPhase | CaptureIngestPhase[]>
}): CaptureQueueStatusLine {
  if (!input.processing) {
    if (input.pendingCount <= 0) {
      return { kind: 'queued', waiting: 0 }
    }
    return { kind: 'queued', waiting: input.pendingCount }
  }
  if (!input.activeEvent) {
    return { kind: 'starting' }
  }
  const stepIndex = pipelineStepIndexFromEvent(input.activeEvent, input.pipeline)
  return {
    kind: 'step',
    label: progressEventLabel(input.activeEvent),
    stepIndex: stepIndex >= 0 ? stepIndex : 0,
  }
}

export function captureQueueStatusText(line: CaptureQueueStatusLine): string {
  switch (line.kind) {
    case 'queued':
      if (line.waiting <= 1) return 'Queued — waiting to start'
      return `Queued — ${line.waiting} captures waiting`
    case 'starting':
      return 'Starting capture…'
    case 'step':
      return line.label
    case 'background':
      if (line.waiting <= 1) return 'Processing in background…'
      return `Processing in background · ${line.waiting} queued`
  }
}
