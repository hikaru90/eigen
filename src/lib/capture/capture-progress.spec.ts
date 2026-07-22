import { describe, expect, it } from 'vitest'
import { CAPTURE_FAST_PIPELINE, CAPTURE_PIPELINE } from './ingest-phases'
import {
  captureQueueStatusLine,
  captureQueueStatusText,
  pipelineStepIndexFromEvent,
  progressEventLabel,
  totalPipelineSteps,
} from './capture-progress'

describe('capture-progress', () => {
  it('counts full pipeline steps', () => {
    expect(totalPipelineSteps(CAPTURE_PIPELINE)).toBe(CAPTURE_PIPELINE.length)
  })

  it('counts fast pipeline steps', () => {
    expect(totalPipelineSteps(CAPTURE_FAST_PIPELINE)).toBe(CAPTURE_FAST_PIPELINE.length)
  })

  it('maps progress event to fast pipeline index', () => {
    const idx = pipelineStepIndexFromEvent(
      { parallel: false, phase: 'persist' },
      CAPTURE_FAST_PIPELINE,
    )
    expect(idx).toBe(CAPTURE_FAST_PIPELINE.indexOf('persist'))
  })

  it('labels parallel progress', () => {
    const label = progressEventLabel({
      parallel: true,
      phases: ['relations', 'entities'],
    })
    expect(label).toContain('Resolving')
    expect(label).toContain('Updating')
  })

  it('queued status when not processing', () => {
    const line = captureQueueStatusLine({
      processing: false,
      pendingCount: 2,
      activeEvent: null,
      pipeline: CAPTURE_PIPELINE,
    })
    expect(line).toEqual({ kind: 'queued', waiting: 2 })
    expect(captureQueueStatusText(line)).toContain('2 captures waiting')
  })

  it('starting status when processing without events', () => {
    const line = captureQueueStatusLine({
      processing: true,
      pendingCount: 0,
      activeEvent: null,
      pipeline: CAPTURE_PIPELINE,
    })
    expect(line).toEqual({ kind: 'starting' })
    expect(captureQueueStatusText(line)).toBe('Starting capture…')
  })

  it('step status when processing with events', () => {
    const event = { parallel: false, phase: 'persist' as const }
    const line = captureQueueStatusLine({
      processing: true,
      pendingCount: 0,
      activeEvent: event,
      pipeline: CAPTURE_PIPELINE,
    })
    expect(line.kind).toBe('step')
    if (line.kind === 'step') {
      expect(line.label).toBe(progressEventLabel(event))
    }
  })
})
