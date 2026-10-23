import { describe, expect, it } from 'vitest'
import {
  buildAssignTaskPayload,
  deskProjectHref,
  deskTaskHref,
  isValidAssignPayload,
  toDeskWallNotes,
} from './desk-links'

describe('deskTaskHref', () => {
  it('links to the task detail deep-link on /memory/tasks', () => {
    expect(deskTaskHref('ev-123')).toBe('/memory/tasks?event=ev-123')
  })

  it('encodes the event id', () => {
    expect(deskTaskHref('ev 1&2')).toBe('/memory/tasks?event=ev%201%262')
  })

  it('throws on an empty id (no silent fallback)', () => {
    expect(() => deskTaskHref('  ')).toThrow()
  })
})

describe('deskProjectHref', () => {
  it('links to the project detail page', () => {
    expect(deskProjectHref('ent-9')).toBe('/memory/projects/ent-9')
  })

  it('throws on an empty id (no silent fallback)', () => {
    expect(() => deskProjectHref('')).toThrow()
  })
})

describe('buildAssignTaskPayload', () => {
  it('maps a task sheet and target pile to the assign API contract', () => {
    expect(
      buildAssignTaskPayload({ thoughtId: ' th1 ' }, { entityId: ' ent1 ' }),
    ).toEqual({ thoughtId: 'th1', projectEntityId: 'ent1' })
  })

  it('throws when the task has no thoughtId', () => {
    expect(() => buildAssignTaskPayload({ thoughtId: '' }, { entityId: 'ent1' })).toThrow(
      /thoughtId/,
    )
  })
})

describe('isValidAssignPayload', () => {
  it('accepts exactly one of projectEntityId or projectLabel', () => {
    expect(isValidAssignPayload({ thoughtId: 't', projectEntityId: 'e' })).toBe(true)
    expect(isValidAssignPayload({ thoughtId: 't', projectLabel: 'L' })).toBe(true)
  })

  it('rejects both, neither, or a missing thoughtId', () => {
    expect(isValidAssignPayload({ thoughtId: 't', projectEntityId: 'e', projectLabel: 'L' })).toBe(
      false,
    )
    expect(isValidAssignPayload({ thoughtId: 't' })).toBe(false)
    expect(isValidAssignPayload({ projectEntityId: 'e' })).toBe(false)
    expect(isValidAssignPayload({ thoughtId: '  ', projectEntityId: 'e' })).toBe(false)
  })
})

describe('toDeskWallNotes', () => {
  it('strips graph nodes down to id, label, and kind (no embeddings)', () => {
    const notes = toDeskWallNotes([
      { id: 'n1', label: 'Jonas', kind: 'Entity', embedding: [0.1, 0.2] } as never,
      { id: 'n2', label: 'A thought', kind: 'Thought' },
    ])
    expect(notes).toEqual([
      { id: 'n1', label: 'Jonas', kind: 'Entity' },
      { id: 'n2', label: 'A thought', kind: 'Thought' },
    ])
  })
})
