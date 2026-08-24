import type { LongMemEvalInstance } from './types'
import { readFileSync } from 'node:fs'

export function loadLongMemEvalDataset(datasetPath: string): LongMemEvalInstance[] {
  const raw = readFileSync(datasetPath, 'utf8')
  const parsed = JSON.parse(raw) as unknown
  if (!Array.isArray(parsed)) {
    throw new Error(`[longmemeval] expected JSON array in ${datasetPath}`)
  }
  return parsed as LongMemEvalInstance[]
}
