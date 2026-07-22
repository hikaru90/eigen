import type { GroundingFacetKey } from '$lib/server/grounding/constants'
import type { CheckInQuestion } from '$lib/server/grounding/next-check-in'

export type GroundingProfileSnapshot = {
  narrativeSummary: string
  facets: Partial<Record<GroundingFacetKey, string>>
  initialCompletedAt: Date | null
  lastSessionAt: Date | null
  sessionCount: number
  lastGroundingPushAt: Date | null
  pendingCheckIn: CheckInQuestion | null
}

export type GroundingProfileForEnrichment = {
  narrativeSummary: string
  facets: Record<string, string>
} | null
