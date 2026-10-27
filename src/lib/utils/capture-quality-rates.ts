/** Rates for the operator capture-quality page. The server sends counts only. */

/** The confidence bands of the calibration tables, lowest first. */
export const QUALITY_BANDS = ['lt_0_5', '0_5_to_0_7', '0_7_to_0_9', 'gte_0_9'] as const
export type QualityBand = (typeof QUALITY_BANDS)[number]

export const QUALITY_BAND_LABELS: Record<QualityBand, string> = {
  lt_0_5: 'Below 0.5',
  '0_5_to_0_7': '0.5 to 0.7',
  '0_7_to_0_9': '0.7 to 0.9',
  gte_0_9: '0.9 and above',
}

export function downRate(band: { voted: number; down: number }): number | null {
  return band.voted === 0 ? null : band.down / band.voted
}

export function formatDownRate(band: { voted: number; down: number }): string {
  const rate = downRate(band)
  return rate === null ? '—' : `${Math.round(rate * 100)}%`
}
