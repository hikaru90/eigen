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

/** Capture count interval before showing an optional grounding / relevance check-in card. */
export const GROUNDING_QUESTION_CAPTURE_INTERVAL = 10;

/** Shared alias — one check-in slot (grounding or relevance) per cadence. */
export const CHECK_IN_QUESTION_CAPTURE_INTERVAL = GROUNDING_QUESTION_CAPTURE_INTERVAL;

/** Minimum days between optional grounding question prompts. */
export const GROUNDING_QUESTION_MIN_DAYS = 7;

/** Shared alias for the check-in cooldown. */
export const CHECK_IN_QUESTION_MIN_DAYS = GROUNDING_QUESTION_MIN_DAYS;

/**
 * Minimum inactive days (no retrieval access, else since create) before a thought
 * may be offered in a relevance check-in.
 */
export const RELEVANCE_CHECKIN_MIN_INACTIVE_DAYS = 14;

/** Salience boost when the user confirms a thought is still relevant. */
export const RELEVANCE_CHECKIN_KEEP_SALIENCE_BOOST = 0.15;

export const RELEVANCE_CHECKIN_SALIENCE_MAX = 5.0;
