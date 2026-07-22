import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CORPUS_REUSE_ENTITY_GATE_BEFORE_THOUGHT_MAP } from './corpus-reuse-gate'

const runEntryPath = resolve(dirname(fileURLToPath(import.meta.url)), 'run-entry.ts')

describe('corpus reuse entity gate', () => {
  it('documents that entity assert precedes thought map upsert', () => {
    expect(CORPUS_REUSE_ENTITY_GATE_BEFORE_THOUGHT_MAP).toBe(true)
  })

  it('run-entry reuse branch asserts entities before upsertThoughtMap', () => {
    const source = readFileSync(runEntryPath, 'utf-8')
    const reuseBlock = source.slice(source.indexOf('shouldReuseCorpusCapture'))
    const assertIdx = reuseBlock.indexOf('assertThoughtEntitiesResolved')
    const mapIdx = reuseBlock.indexOf('upsertThoughtMap')
    expect(assertIdx).toBeGreaterThan(-1)
    expect(mapIdx).toBeGreaterThan(-1)
    expect(assertIdx).toBeLessThan(mapIdx)
  })
})
