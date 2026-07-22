import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const CORPUS_PATH = resolve(__dirname, '../datasets/corpus.yaml')

export type CorpusThought = {
  id: string
  rawText: string
  cluster: string
  createdAt?: string
}

export type CorpusFile = {
  thoughts: CorpusThought[]
}

function loadYaml<T>(path: string): T {
  if (!existsSync(path)) {
    throw new Error(`[eval] dataset file missing: ${path}`)
  }
  const raw = readFileSync(path, 'utf-8')
  const parsed = yaml.load(raw)
  if (parsed === undefined || parsed === null) {
    throw new Error(`[eval] dataset file is empty: ${path}`)
  }
  return parsed as T
}

/** Passive fixture library: optional rawText fallback when expanding eval_qa captures. */
export function loadCorpus(): CorpusFile {
  const file = loadYaml<{
    thoughts: Array<{
      id: string
      rawText: string
      cluster: string
      createdAt?: string
    }>
  }>(CORPUS_PATH)
  return {
    thoughts: file.thoughts.map((t) => ({
      id: t.id,
      rawText: t.rawText,
      cluster: t.cluster,
      ...(t.createdAt ? { createdAt: t.createdAt } : {}),
    })),
  }
}
