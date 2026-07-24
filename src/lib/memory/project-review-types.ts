/** Shared client/server types for project tidy-up review (no $lib/server imports). */

export type ProjectReviewSuggestion = 'keep' | 'mark_done' | 'archive'

export type ProjectReviewTemporalKind =
  | 'deadline'
  | 'appointment'
  | 'milestone'
  | 'period'
  | 'reminder'
  | 'inferred_event'

export type ProjectReviewTaskReview = {
  thoughtId: string
  suggestion: ProjectReviewSuggestion
  deadline: string | null
  reason: string
}

export type ProjectReviewNewTaskSuggestion = {
  summary: string
  kind: ProjectReviewTemporalKind | null
  suggestedStartAt: string | null
  suggestedEndAt: string | null
  reason: string
}

export type ProjectReviewExtraction = {
  projectDeadline: string | null
  taskReviews: ProjectReviewTaskReview[]
  order: string[]
  newTaskSuggestions: ProjectReviewNewTaskSuggestion[]
  nextActionThoughtId: string | null
  nextActionIsNewTaskIndex: number | null
}

export type ProjectReviewTaskInput = {
  thoughtId: string
  summary: string
  rank: number
  status: 'open' | 'done' | 'archived'
  deadline: string | null
  isNextAction: boolean
}

/** Dry-run payload from POST /api/timeline/projects/[entityId]/review */
export type ReviewProjectResponse = {
  projectEntityId: string
  projectLabel: string
  projectDeadline: string | null
  tasks: ProjectReviewTaskInput[]
  linkedThoughts: Array<{ thoughtId: string; summary: string }>
  allowedThoughtIds: string[]
  review: ProjectReviewExtraction
}

/** Confirmed apply body for POST /api/timeline/projects/[entityId]/review/apply */
export type ApplyProjectReviewRequest = {
  markDone?: string[]
  archive?: string[]
  deadlines?: Array<{ thoughtId: string; targetDate: string }>
  order?: string[]
  projectDeadline?: string | null
  newTasks?: Array<{
    summary: string
    kind?: ProjectReviewTemporalKind | null
    suggestedStartAt?: string | null
    suggestedEndAt?: string | null
  }>
  nextActionThoughtId?: string | null
  nextActionNewTaskIndex?: number | null
  allowedThoughtIds?: string[]
}

export type ApplyProjectReviewResponse = {
  projectEntityId: string
  createdThoughtIds: string[]
  nextActionThoughtId: string | null
}
