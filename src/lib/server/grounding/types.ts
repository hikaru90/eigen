import type { GroundingFacetKey } from '$lib/server/grounding/constants';

export type GroundingProfileSnapshot = {
	narrativeSummary: string;
	facets: Partial<Record<GroundingFacetKey, string>>;
	initialCompletedAt: Date | null;
	lastSessionAt: Date | null;
	sessionCount: number;
};

export type GroundingProfileForEnrichment = {
	narrativeSummary: string;
	facets: Record<string, string>;
} | null;
