import { captureQueueItemPreview } from './queue/snapshot'

export const INTERPRET_PENDING_STATUS_LABEL = 'Interpreting'
export const INTERPRET_PENDING_STEP_TITLE = 'Reading your thought'
export const INTERPRET_PENDING_STEP_DESCRIPTION =
  'Preparing this capture and checking whether it needs a confirmation preview.'

export function interpretPendingView(raw: string): {
  preview: string
  statusLabel: string
  stepTitle: string
  stepDescription: string
} {
  return {
    preview: captureQueueItemPreview(raw),
    statusLabel: INTERPRET_PENDING_STATUS_LABEL,
    stepTitle: INTERPRET_PENDING_STEP_TITLE,
    stepDescription: INTERPRET_PENDING_STEP_DESCRIPTION,
  }
}
