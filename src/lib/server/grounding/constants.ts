/** Canonical facet keys for grounding profile slices (format validation only). */
export const GROUNDING_FACET_KEYS = [
	'identity',
	'work',
	'values',
	'relationships',
	'psychology',
	'routines',
	'projects'
] as const;

export type GroundingFacetKey = (typeof GROUNDING_FACET_KEYS)[number];

export const GROUNDING_FACET_KEY_SET = new Set<string>(GROUNDING_FACET_KEYS);

/** Max chars per facet content stored in DB. */
export const GROUNDING_FACET_MAX_CHARS = 2000;

/** Max chars for synthesized narrative summary. */
export const GROUNDING_NARRATIVE_MAX_CHARS = 4000;

/** Days without a grounding session before showing a re-grounding nudge. */
export const GROUNDING_REGROUND_DAYS = 90;

/** Thought count interval for re-grounding nudge (after initial completion). */
export const GROUNDING_REGROUND_THOUGHT_INTERVAL = 100;

/** Distinct facets captured before suggesting complete_grounding_session. */
export const GROUNDING_SUGGEST_COMPLETE_FACET_COUNT = 4;
