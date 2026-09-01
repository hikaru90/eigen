import { describe, expect, it } from 'vitest'
import { parseProjectTaskStatusFilter } from './project-task-status-filter'

describe('parseProjectTaskStatusFilter', () => {
  it('accepts open and all', () => {
    expect(parseProjectTaskStatusFilter('open')).toBe('open')
    expect(parseProjectTaskStatusFilter('all')).toBe('all')
  })

  it('defaults invalid or missing values to open', () => {
    expect(parseProjectTaskStatusFilter(null)).toBe('open')
    expect(parseProjectTaskStatusFilter(undefined)).toBe('open')
    expect(parseProjectTaskStatusFilter('done')).toBe('open')
    expect(parseProjectTaskStatusFilter('')).toBe('open')
  })
})
