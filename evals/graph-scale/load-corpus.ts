import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const GRAPH_SCALE_CORPUS_PATH = resolve(__dirname, 'datasets/single-thought-corpus.yaml')

export type GraphScaleCorpusThought = {
  id: string
  rawText: string
  theme: string
}

export type GraphScaleCorpusFile = {
  thoughts: GraphScaleCorpusThought[]
}

function loadYaml<T>(path: string): T {
  if (!existsSync(path)) {
    throw new Error(`[graph-scale] corpus file missing: ${path}`)
  }
  const raw = readFileSync(path, 'utf-8')
  const parsed = load(raw)
  if (parsed === undefined || parsed === null) {
    throw new Error(`[graph-scale] corpus file is empty: ${path}`)
  }
  return parsed as T
}

/** Atomic single-thought fixtures for graph-scale economics (not eval QA corpus). */
export function loadGraphScaleCorpus(): GraphScaleCorpusFile {
  const file = loadYaml<{
    thoughts: Array<{ id: string; rawText: string; theme: string }>
  }>(GRAPH_SCALE_CORPUS_PATH)
  if (!Array.isArray(file.thoughts) || file.thoughts.length === 0) {
    throw new Error('[graph-scale] single-thought-corpus.yaml has no thoughts')
  }
  return {
    thoughts: file.thoughts.map((t) => ({
      id: t.id,
      rawText: t.rawText.trim(),
      theme: t.theme.trim(),
    })),
  }
}
