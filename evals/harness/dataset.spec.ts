import { describe, expect, it } from 'vitest'
import { CORPUS_PATH, loadCorpus } from './dataset'

describe('loadCorpus', () => {
  it('loads the eval corpus yaml file', () => {
    const corpus = loadCorpus()

    expect(CORPUS_PATH.endsWith('evals/datasets/corpus.yaml')).toBe(true)
    expect(corpus.thoughts.length).toBeGreaterThan(0)
    expect(corpus.thoughts[0]?.id.trim().length).toBeGreaterThan(0)
    expect(corpus.thoughts[0]?.rawText.trim().length).toBeGreaterThan(0)
  })
})
