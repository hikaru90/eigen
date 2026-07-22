/** Default when nothing is stored and inference is unavailable (GMT+1). */
export const DEFAULT_TIMEZONE_OFFSET_MINUTES = 60

const MIN_OFFSET_HOURS = -12
const MAX_OFFSET_HOURS = 14

export type TimezoneOffsetOption = {
  value: number
  label: string
}

/** Representative city name for each whole-hour offset (used in dropdown labels). */
const CITY_BY_OFFSET: Partial<Record<number, string>> = {
  [-720]: 'Pago Pago',
  [-660]: 'Papeete',
  [-600]: 'Honolulu',
  [-540]: 'Anchorage',
  [-480]: 'Los Angeles',
  [-420]: 'Denver',
  [-360]: 'Chicago',
  [-300]: 'New York',
  [-240]: 'Halifax',
  [-180]: "St. John's",
  [-120]: 'Rio de Janeiro',
  [-60]: 'Azores',
  [0]: 'London',
  [60]: 'Berlin',
  [120]: 'Helsinki',
  [180]: 'Moscow',
  [240]: 'Tbilisi',
  [270]: 'Tehran',
  [300]: 'Dubai',
  [330]: 'Kolkata',
  [345]: 'Kathmandu',
  [360]: 'Dhaka',
  [390]: 'Yangon',
  [420]: 'Bangkok',
  [480]: 'Shanghai',
  [540]: 'Tokyo',
  [570]: 'Adelaide',
  [600]: 'Sydney',
  [660]: 'Auckland',
  [720]: 'Kiritimati',
  [780]: 'Tongatapu',
  [840]: 'Apia',
}

export const TIMEZONE_OFFSET_OPTIONS: TimezoneOffsetOption[] = Array.from(
  { length: MAX_OFFSET_HOURS - MIN_OFFSET_HOURS + 1 },
  (_, index) => {
    const hours = MIN_OFFSET_HOURS + index
    const value = hours * 60
    const gmt = hours === 0 ? 'GMT' : `GMT${hours > 0 ? '+' : ''}${hours}`
    const city = CITY_BY_OFFSET[value]
    const label = city ? `${gmt} (${city})` : gmt
    return { value, label }
  },
)

export function formatGMTOffset(offsetMinutes: number): string {
  const hours = Math.round(offsetMinutes / 60)
  if (hours === 0) return 'GMT'
  return `GMT${hours > 0 ? '+' : ''}${hours}`
}

export function nearestOptionOffset(offsetMinutes: number): number {
  const hours = Math.round(offsetMinutes / 60)
  const clamped = Math.max(MIN_OFFSET_HOURS, Math.min(MAX_OFFSET_HOURS, hours))
  return clamped * 60
}

/** Browser IANA timezone when available (e.g. Europe/Berlin). */
export function inferBrowserIanaTimezone(): string | null {
  try {
    const iana = Intl.DateTimeFormat().resolvedOptions().timeZone?.trim()
    return iana || null
  } catch {
    return null
  }
}

export function labelForOffsetMinutes(offsetMinutes: number): string {
  const rounded = nearestOptionOffset(offsetMinutes)
  const option = TIMEZONE_OFFSET_OPTIONS.find((entry) => entry.value === rounded)
  return option?.label ?? formatGMTOffset(rounded)
}

/** Browser-local offset in minutes east of GMT (e.g. GMT+1 → 60). */
export function inferBrowserOffsetMinutes(): number {
  try {
    const iana = inferBrowserIanaTimezone()
    if (iana) return nearestOptionOffset(offsetMinutesForIana(iana))
  } catch {
    // fall through
  }
  return nearestOptionOffset(-new Date().getTimezoneOffset())
}

/** GMT label for the browser-local offset (e.g. GMT+2 (Helsinki)). */
export function inferBrowserOffsetLabel(): string {
  return labelForOffsetMinutes(inferBrowserOffsetMinutes())
}

const GMT_ZERO_ALIASES = new Set(['GMT', 'UTC', 'Etc/GMT', 'Etc/UTC', 'Z'])

export function offsetMinutesForIana(timeZone: string, at = new Date()): number {
  const normalized = timeZone.trim()
  if (GMT_ZERO_ALIASES.has(normalized)) return 0

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: normalized,
    timeZoneName: 'shortOffset',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(at)
  const tzName = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT'
  if (tzName === 'GMT' || tzName === 'UTC') return 0
  const match = /(?:GMT|UTC)([+-])(\d{1,2})(?::(\d{2}))?/.exec(tzName)
  if (!match) return 0
  const sign = match[1] === '+' ? 1 : -1
  const hours = Number.parseInt(match[2], 10)
  const minutes = Number.parseInt(match[3] ?? '0', 10)
  return sign * (hours * 60 + minutes)
}

/** Map a whole-hour GMT offset to a fixed-offset IANA Etc/GMT zone (no DST drift on reload). */
export function ianaFromOffsetMinutes(offsetMinutes: number): string {
  const rounded = nearestOptionOffset(offsetMinutes)
  if (rounded === 0) return 'Etc/GMT'
  const hours = Math.abs(rounded / 60)
  // IANA Etc/GMT labels use inverted signs.
  if (rounded > 0) return `Etc/GMT-${hours}`
  return `Etc/GMT+${hours}`
}

/** Resolve a stored IANA zone to the dropdown offset, preferring a persisted offset when present. */
export function offsetMinutesForUiPreference(
  storedTimezone: string | null | undefined,
  storedOffsetMinutes: number | null | undefined,
  at = new Date(),
): number | null {
  if (storedOffsetMinutes != null && Number.isFinite(storedOffsetMinutes)) {
    return nearestOptionOffset(storedOffsetMinutes)
  }
  const trimmed = storedTimezone?.trim()
  if (!trimmed) return null
  return nearestOptionOffset(offsetMinutesForIana(trimmed, at))
}
