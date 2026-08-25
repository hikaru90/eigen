import { describe, expect, it } from 'vitest'
import { GRAPH_SCALE_CORPUS_PATH, loadGraphScaleCorpus } from './load-corpus'

describe('loadGraphScaleCorpus', () => {
  it('loads the graph-scale corpus yaml file', () => {
    const corpus = loadGraphScaleCorpus()

    expect(GRAPH_SCALE_CORPUS_PATH.endsWith('evals/graph-scale/datasets/single-thought-corpus.yaml')).toBe(
      true,
    )
    expect(corpus.thoughts.length).toBeGreaterThan(0)
    expect(corpus.thoughts[0]?.id.trim().length).toBeGreaterThan(0)
    expect(corpus.thoughts[0]?.rawText.trim().length).toBeGreaterThan(0)
    expect(corpus.thoughts[0]?.theme.trim().length).toBeGreaterThan(0)
  })
})
