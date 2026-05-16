/**
 * Dimension-level pass thresholds for the golden baseline eval framework.
 *
 * Each dimension maps to a minimum weighted score (1..5 scale) that a case
 * must reach to be counted as passing.
 *
 * These values are derived from the document's 0–3 minimum thresholds by
 * mapping the 0–3 rubric onto the 1–5 internal scale:
 *
 *   doc threshold 2.5 → internal 4.0  (solid pass)
 *   doc threshold 2.0 → internal 3.5  (meets standard)
 *   doc threshold 1.8 → internal 3.2  (acceptable for synthesis/personalization)
 *   doc threshold 1.5 → internal 2.75 (proactive recall — lower bar)
 *   doc threshold 2.8 → internal 4.3  (privacy — highest bar)
 *
 * The `default` threshold applies to any case that has no dimension tag or
 * whose dimension is not listed here.
 */
export type EvalDimension =
	| 'faithful_recall'
	| 'temporal_reasoning'
	| 'synthesis'
	| 'personalization'
	| 'contextual_relevance'
	| 'graceful_uncertainty'
	| 'contradiction_detection'
	| 'proactive_recall'
	| 'privacy_scoping'
	| 'memory_decay'
	| 'default';

/** Minimum weighted score (1–5) for a case to be considered passing. */
export const DIMENSION_PASS_THRESHOLDS: Record<EvalDimension, number> = {
	faithful_recall: 4.0,
	temporal_reasoning: 3.5,
	synthesis: 3.2,
	personalization: 3.2,
	contextual_relevance: 3.5,
	graceful_uncertainty: 4.0,
	contradiction_detection: 3.5,
	proactive_recall: 2.75,
	privacy_scoping: 4.3,
	memory_decay: 3.5,
	/** Legacy / untagged cases: same bar as the original 3/5 pass threshold. */
	default: 3.0
};

/** Human-readable display names for each dimension. */
export const DIMENSION_LABELS: Record<EvalDimension, string> = {
	faithful_recall: 'Faithful Recall',
	temporal_reasoning: 'Temporal Reasoning',
	synthesis: 'Synthesis & Connection',
	personalization: 'Personalization',
	contextual_relevance: 'Contextual Relevance',
	graceful_uncertainty: 'Graceful Uncertainty',
	contradiction_detection: 'Contradiction Detection',
	proactive_recall: 'Proactive Recall',
	privacy_scoping: 'Privacy & Scoping',
	memory_decay: 'Memory Decay & Staleness',
	default: 'General'
};

/**
 * Returns the pass threshold for a given dimension string.
 * Falls back to `default` for unknown or missing dimension values.
 */
export function getPassThreshold(dimension: string | undefined): number {
	if (!dimension) return DIMENSION_PASS_THRESHOLDS.default;
	const key = dimension as EvalDimension;
	return DIMENSION_PASS_THRESHOLDS[key] ?? DIMENSION_PASS_THRESHOLDS.default;
}
