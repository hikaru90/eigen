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

/** Capture count interval before showing an optional grounding question card. */
export const GROUNDING_QUESTION_CAPTURE_INTERVAL = 10;

/** Minimum days between optional grounding question prompts. */
export const GROUNDING_QUESTION_MIN_DAYS = 7;
