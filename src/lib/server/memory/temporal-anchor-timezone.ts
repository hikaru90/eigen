/**
 * Sync fallback IANA timezone when user preference is unavailable (e.g. tests).
 * Prefer {@link getUserPreferredTimezone} in async server paths.
 */
export function getTemporalAnchorTimezone(): string {
  const fromEnv = process.env.TEMPORAL_ANCHOR_TZ?.trim()
  return fromEnv || 'UTC'
}
