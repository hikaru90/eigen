import { describe, expect, it } from 'vitest'
import { activeMemorySurfaceTab } from './memory-surface-nav'

describe('activeMemorySurfaceTab', () => {
  it('returns graph for /memory', () => {
    expect(activeMemorySurfaceTab('/memory', null)).toBe('graph')
  })

  it('returns embeddings for /memory?view=embeddings', () => {
    expect(activeMemorySurfaceTab('/memory', 'embeddings')).toBe('embeddings')
  })

  it('returns tasks for /memory/tasks', () => {
    expect(activeMemorySurfaceTab('/memory/tasks', null)).toBe('tasks')
  })

  it('returns projects for /memory/projects', () => {
    expect(activeMemorySurfaceTab('/memory/projects', null)).toBe('projects')
  })

  it('returns notes for /memory/notes', () => {
    expect(activeMemorySurfaceTab('/memory/notes', null)).toBe('notes')
  })
})
