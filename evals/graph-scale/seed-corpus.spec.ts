import { describe, expect, it } from 'vitest'
import { loadGraphScaleCorpus } from './load-corpus'
import {
  buildCorpusTexts,
  buildRepeatedProbeTexts,
  buildSpendPicnicProbeTexts,
  graphScaleCorpusUserId,
  graphScaleSpendProbeText,
  GRAPH_SCALE_SPEND_PICNIC_PROBE,
  GRAPH_SCALE_SPEND_PICNIC_PROBE_MAX,
  overflowCaptureText,
} from './seed-corpus'

describe('graph-scale seed corpus', () => {
  it('graphScaleCorpusUserId encodes run and size', () => {
    expect(graphScaleCorpusUserId('run-1', 100)).toBe('graph-scale-corpus-run-1-100')
  })

  it('loads atomic single-thought fixtures (not eval QA corpus)', () => {
    const corpus = loadGraphScaleCorpus()
    expect(corpus.thoughts.length).toBeGreaterThanOrEqual(60)
    expect(corpus.thoughts[0].rawText).toMatch(/Pick up AA batteries/)
    for (const thought of corpus.thoughts) {
      expect(thought.rawText.length).toBeGreaterThan(10)
      expect(thought.rawText.length).toBeLessThan(200)
      expect(thought.rawText).not.toMatch(/Marcus|Tartine|Sarah|EigenMesh|Yosemite/i)
    }
  })

  it('buildCorpusTexts uses fixtures first then overflow captures', () => {
    const corpus = loadGraphScaleCorpus()
    const texts = buildCorpusTexts(corpus.thoughts.length + 2)
    expect(texts[0]).toBe(corpus.thoughts[0].rawText)
    expect(texts[corpus.thoughts.length]).toBe(overflowCaptureText(corpus.thoughts.length))
    expect(texts[corpus.thoughts.length + 1]).toBe(overflowCaptureText(corpus.thoughts.length + 1))
  })

  it('rejects non-positive count', () => {
    expect(() => buildCorpusTexts(0)).toThrow(/positive integer/)
  })

  it('buildRepeatedProbeTexts repeats one fixture for comparable spend runs', () => {
    const probe = graphScaleSpendProbeText()
    const texts = buildRepeatedProbeTexts(10)
    expect(texts).toHaveLength(10)
    expect(new Set(texts).size).toBe(1)
    expect(texts[0]).toBe(probe)
    expect(texts[9]).toBe(probe)
  })

  it('buildSpendPicnicProbeTexts returns linked picnic sequence', () => {
    expect(GRAPH_SCALE_SPEND_PICNIC_PROBE).toHaveLength(20)
    const texts = buildSpendPicnicProbeTexts(20)
    expect(texts).toHaveLength(20)
    expect(texts[0]).toBe(GRAPH_SCALE_SPEND_PICNIC_PROBE[0])
    expect(texts[1]).toMatch(/bread/)
    expect(texts[3]).toMatch(/blanket/)
    expect(texts[19]).toMatch(/umbrella/)
    expect(texts.every((t) => t.toLowerCase().includes('picnic') || t.includes('fish'))).toBe(true)
  })

  it('buildSpendPicnicProbeTexts cycles fixtures beyond the base list', () => {
    const texts = buildSpendPicnicProbeTexts(50)
    expect(texts).toHaveLength(50)
    expect(texts[0]).toBe(GRAPH_SCALE_SPEND_PICNIC_PROBE[0])
    expect(texts[20]).toBe(GRAPH_SCALE_SPEND_PICNIC_PROBE[0])
    expect(texts[49]).toBe(GRAPH_SCALE_SPEND_PICNIC_PROBE[9])
    expect(() => buildSpendPicnicProbeTexts(GRAPH_SCALE_SPEND_PICNIC_PROBE_MAX + 1)).toThrow(
      /exceeds picnic probe max/,
    )
  })
})
