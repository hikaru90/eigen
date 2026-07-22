import { describe, expect, it } from 'vitest'
import {
  emptyOntologyProfile,
  baselineOntologyProfile,
  mergeOntologyProfileWithBaseline,
  parseOntologyProfileJson,
  ontologyKindsPromptBlock,
  ONTOLOGY_PROFILE_VERSION,
} from './types'

describe('parseOntologyProfileJson', () => {
  it('returns empty profile for non-objects', () => {
    expect(parseOntologyProfileJson(null)).toEqual(emptyOntologyProfile())
    expect(parseOntologyProfileJson(3)).toEqual(emptyOntologyProfile())
  })

  it('returns empty when version is unknown', () => {
    expect(parseOntologyProfileJson({ version: 99, kindGuidance: { task: 'x' } })).toEqual(
      emptyOntologyProfile(),
    )
  })

  it('parses v2 kindGuidance and summary with length caps', () => {
    const long = 'a'.repeat(5000)
    const parsed = parseOntologyProfileJson({
      version: ONTOLOGY_PROFILE_VERSION,
      kindGuidance: { task: long, memory: '  recall  ' },
      summary: 'b'.repeat(5000),
    })
    expect(parsed.kindGuidance?.task?.length).toBe(2000)
    expect(parsed.kindGuidance?.memory).toBe('recall')
    expect(parsed.summary?.length).toBe(4000)
  })

  it('migrates v1 profiles to v2 keeping summary only', () => {
    const parsed = parseOntologyProfileJson({
      version: 1,
      categoryGuidance: { task: 'ignored' },
      summary: 'kept',
    })
    expect(parsed.version).toBe(ONTOLOGY_PROFILE_VERSION)
    expect(parsed.summary).toBe('kept')
    expect(parsed.kindGuidance).toBeUndefined()
  })
})

describe('baselineOntologyProfile', () => {
  it('defines a corpus summary', () => {
    const b = baselineOntologyProfile()
    expect(b.summary?.length).toBeGreaterThan(20)
    expect(b.version).toBe(ONTOLOGY_PROFILE_VERSION)
  })
})

describe('mergeOntologyProfileWithBaseline', () => {
  it('fills summary from baseline when stored is empty', () => {
    const m = mergeOntologyProfileWithBaseline(emptyOntologyProfile())
    expect(m.summary).toContain('ontology entity kinds')
  })

  it('keeps stored summary and kindGuidance', () => {
    const m = mergeOntologyProfileWithBaseline({
      version: ONTOLOGY_PROFILE_VERSION,
      kindGuidance: { task: 'User note' },
      summary: 'Custom summary',
    })
    expect(m.kindGuidance?.task).toBe('User note')
    expect(m.summary).toBe('Custom summary')
  })
})

describe('ontologyKindsPromptBlock', () => {
  it('includes summary and kind definitions', () => {
    const block = ontologyKindsPromptBlock(
      [
        { key: 'task', name: 'Task', definition: 'Something to do' },
        { key: 'memory', name: 'Memory', definition: 'Past experience' },
      ],
      emptyOntologyProfile(),
    )
    expect(block).toContain('task')
    expect(block).toContain('memory')
    expect(block).toContain('Something to do')
  })

  it('includes labeling notes from profile', () => {
    const block = ontologyKindsPromptBlock(
      [{ key: 'task', name: 'Task', definition: 'Something to do' }],
      {
        version: ONTOLOGY_PROFILE_VERSION,
        kindGuidance: { task: 'Prefer actionable items' },
      },
    )
    expect(block).toContain('[labeling note: Prefer actionable items]')
  })
})
