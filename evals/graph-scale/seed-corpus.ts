import { loadGraphScaleCorpus } from './load-corpus'

const OVERFLOW_THEMES = [
  'errand',
  'appointment',
  'home task',
  'work note',
  'health reminder',
  'finance item',
  'idea',
  'admin task',
] as const

/** Natural single-thought text when N exceeds fixture count (dedup-safe, still atomic). */
export function overflowCaptureText(index: number): string {
  const theme = OVERFLOW_THEMES[index % OVERFLOW_THEMES.length]
  return `Standalone ${theme} ${index + 1}: jot down and act when convenient.`
}

/** Build N atomic capture texts from the graph-scale single-thought corpus. */
export function buildCorpusTexts(count: number): string[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`buildCorpusTexts: count must be a positive integer, got ${count}`)
  }
  const corpus = loadGraphScaleCorpus()
  const texts: string[] = []
  for (let i = 0; i < count; i++) {
    if (i < corpus.thoughts.length) {
      texts.push(corpus.thoughts[i].rawText)
    } else {
      texts.push(overflowCaptureText(i))
    }
  }
  return texts
}

/** Canonical single-thought text for repeatable spend probes. */
export function graphScaleSpendProbeText(): string {
  return GRAPH_SCALE_SPEND_PICNIC_PROBE[0]
}

/**
 * Linked picnic captures for spend probes: recurring picnic + distinct items
 * so entity resolution should connect them in the graph across ingests.
 */
export const GRAPH_SCALE_SPEND_PICNIC_PROBE = [
  'I want to do a picnic and I need to bring fish.',
  'I need to bring bread for the picnic.',
  'I need to bring water for the picnic.',
  'I need to bring a picnic blanket.',
  'I need to bring a picnic table.',
  'I need to bring cheese for the picnic.',
  'I need to bring fruit for the picnic.',
  'I need to bring plates for the picnic.',
  'I need to bring cups for the picnic.',
  'I need to bring a corkscrew for the picnic wine.',
  'I need to bring napkins for the picnic.',
  'I need to bring sunscreen for the picnic.',
  'I need to bring ice for the picnic cooler.',
  'I need to bring lemonade for the picnic.',
  'I need to bring chips for the picnic.',
  'I need to bring a frisbee for the picnic.',
  'I need to bring bug spray for the picnic.',
  'I need to bring trash bags for the picnic.',
  'I need to bring charcoal for the picnic grill.',
  'I need to bring an umbrella for the picnic shade.',
] as const

export const GRAPH_SCALE_SPEND_PICNIC_PROBE_MAX = 100

/** First N picnic probe thoughts; cycles fixtures when count exceeds the base list. */
export function buildSpendPicnicProbeTexts(count: number): string[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`buildSpendPicnicProbeTexts: count must be a positive integer, got ${count}`)
  }
  if (count > GRAPH_SCALE_SPEND_PICNIC_PROBE_MAX) {
    throw new Error(
      `buildSpendPicnicProbeTexts: count ${count} exceeds picnic probe max (${GRAPH_SCALE_SPEND_PICNIC_PROBE_MAX})`,
    )
  }
  const probe = GRAPH_SCALE_SPEND_PICNIC_PROBE
  return Array.from({ length: count }, (_, i) => probe[i % probe.length]!)
}

/** Repeat one atomic capture text N times (comparable ingest cost as the graph grows). */
export function buildRepeatedProbeTexts(count: number, rawText?: string): string[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`buildRepeatedProbeTexts: count must be a positive integer, got ${count}`)
  }
  const text = (rawText ?? graphScaleSpendProbeText()).trim()
  if (!text) {
    throw new Error('buildRepeatedProbeTexts: rawText is required')
  }
  return Array.from({ length: count }, () => text)
}

export function graphScaleCorpusUserId(runId: string, n: number): string {
  return `graph-scale-corpus-${runId}-${n}`
}
