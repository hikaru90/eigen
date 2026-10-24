import { describe, expect, it } from 'vitest'
import { FEEDBACK_MAX_LENGTH } from '$lib/feedback/feedback-max-length'
import {
  boardCheckBodySchema,
  boardCreateBodySchema,
  parseBoardPatch,
  parseIdeaId,
  parseVoteDirection,
} from './contract'
import { BoardError } from './errors'

describe('board contract', () => {
  it('trims titles and enforces the shared length limit', () => {
    expect(boardCheckBodySchema.parse({ title: '  Dark mode  ' })).toEqual({ title: 'Dark mode' })
    expect(boardCheckBodySchema.safeParse({ title: '   ' }).success).toBe(false)
    expect(
      boardCheckBodySchema.safeParse({ title: 'x'.repeat(FEEDBACK_MAX_LENGTH + 1) }).success,
    ).toBe(false)
    expect(boardCheckBodySchema.safeParse({ title: 'ok', extra: 1 }).success).toBe(false)
  })

  it('requires a known kind and area on create', () => {
    expect(boardCreateBodySchema.parse({ title: 'x', kind: 'bug', area: 'capture' })).toEqual({
      title: 'x',
      kind: 'bug',
      area: 'capture',
    })
    expect(
      boardCreateBodySchema.safeParse({ title: 'x', kind: 'feature', area: 'capture' }).success,
    ).toBe(false)
    expect(boardCreateBodySchema.safeParse({ title: 'x', kind: 'bug', area: 'mars' }).success).toBe(
      false,
    )
  })

  it('accepts -1, 0 and 1 as vote directions', () => {
    expect(parseVoteDirection(-1)).toBe(-1)
    expect(parseVoteDirection(0)).toBe(0)
    expect(parseVoteDirection(1)).toBe(1)
  })

  it('fails loud on any other direction (agent-benchmark negative probe)', () => {
    expect(() => parseVoteDirection(2)).toThrow('Invalid direction: 2. Must be -1, 0 or 1')
    expect(() => parseVoteDirection('1')).toThrow('Invalid direction: "1". Must be -1, 0 or 1')
    expect(() => parseVoteDirection(undefined)).toThrow(/Invalid direction: undefined/)
    expect(() => parseVoteDirection(0.5)).toThrow(BoardError)
  })

  it('validates idea ids as UUIDs', () => {
    const id = '0b6c2d6c-5ac4-4c39-9a0f-8d2b8f7d2f51'
    expect(parseIdeaId(` ${id} `)).toBe(id)
    expect(() => parseIdeaId('fx-r1')).toThrow('Invalid idea_id: "fx-r1". Must be a UUID')
    expect(() => parseIdeaId('')).toThrow(/Invalid idea_id/)
  })

  it('routes a patch to the author path (kind/area) or the admin path (title/status/planned/note/hidden)', () => {
    expect(parseBoardPatch({ kind: 'bug' })).toEqual({ scope: 'author', patch: { kind: 'bug' } })
    expect(parseBoardPatch({ status: 'shipped', note: 'Done!' })).toEqual({
      scope: 'admin',
      patch: { status: 'shipped', note: 'Done!' },
    })
    expect(parseBoardPatch({ note: null })).toEqual({ scope: 'admin', patch: { note: null } })
    expect(parseBoardPatch({ title: ' renamed ' })).toEqual({
      scope: 'admin',
      patch: { title: 'renamed' },
    })
  })

  it('rejects empty, mixed or unknown patches with 400', () => {
    for (const body of [{}, { kind: 'bug', status: 'shipped' }, { kind: 'bug', title: 'renamed' }, { title: '  ' }, { colour: 'red' }, null]) {
      try {
        parseBoardPatch(body)
        throw new Error('expected a BoardError')
      } catch (err) {
        expect(err).toBeInstanceOf(BoardError)
        expect((err as BoardError).status).toBe(400)
      }
    }
  })

  it('accepts rejected as a maker status (hidden from the board, not a tab)', () => {
    expect(parseBoardPatch({ status: 'rejected', note: 'Not for Eigenmesh.' })).toEqual({
      scope: 'admin',
      patch: { status: 'rejected', note: 'Not for Eigenmesh.' },
    })
    expect(() => parseBoardPatch({ status: 'declined' })).toThrow()
  })
})
