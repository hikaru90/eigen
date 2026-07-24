import { describe, expect, it } from 'vitest'
import { parseProjectViewMode } from './project-view-mode'

describe('parseProjectViewMode', () => {
  it('accepts list, timeline, and kanban', () => {
    expect(parseProjectViewMode('list')).toBe('list')
    expect(parseProjectViewMode('timeline')).toBe('timeline')
    expect(parseProjectViewMode('kanban')).toBe('kanban')
  })

  it('defaults invalid or missing values to list', () => {
    expect(parseProjectViewMode(null)).toBe('list')
    expect(parseProjectViewMode(undefined)).toBe('list')
    expect(parseProjectViewMode('gantt')).toBe('list')
    expect(parseProjectViewMode('')).toBe('list')
  })
})
