/** The You menu's usage bar: credits left against the balance at the last funding. */
export type CreditMeter = {
  /** Spendable credits now. */
  available: number
  /** Credits debited for usage since the most recent top-up or grant. */
  spentSinceFunding: number
}

/** Share of the last funding still left, in [0, 1]. */
export function creditMeterFraction(meter: CreditMeter): number {
  const available = Math.max(0, meter.available)
  const funded = available + Math.max(0, meter.spentSinceFunding)
  if (funded === 0) return 0
  return Math.min(1, available / funded)
}
