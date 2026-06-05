/**
 * IANA timezone used to resolve relative dates ("heute", "today") at capture.
 * User-specific timezone preference is not stored yet; override via env for operators.
 */
export function getTemporalAnchorTimezone(_userId?: string): string {
	const fromEnv = process.env.TEMPORAL_ANCHOR_TZ?.trim();
	return fromEnv || 'UTC';
}
