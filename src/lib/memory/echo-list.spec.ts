import { describe, expect, it } from 'vitest'
import { ECHO_LIMIT, ECHO_TOP_K, pickEchoRows } from './echo-list'

/**
 * ECHOES on the thought page (ei app.js:1334 `echoesOf(t, 3)`): the close thoughts
 * from the existing retrieval endpoint, never the thought itself, at most three.
 * Only display fields are read — embeddings never reach the client.
 */
describe('pickEchoRows', () => {
  const rows = [
    { id: 'self', normalizedText: 'the thought itself', createdAt: '2026-10-19T09:00:00.000Z' },
    { id: 'a', normalizedText: 'first echo', createdAt: '2026-10-18T09:00:00.000Z' },
    { id: 'b', normalizedText: 'second echo', createdAt: '2026-10-17T09:00:00.000Z' },
    { id: 'c', normalizedText: 'third echo', createdAt: '2026-10-16T09:00:00.000Z' },
    { id: 'd', normalizedText: 'fourth echo', createdAt: '2026-10-15T09:00:00.000Z' },
  ]

  it('skips the thought itself and keeps at most three rows, in retrieval order', () => {
    const picked = pickEchoRows(rows, 'self')
    expect(picked.map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(picked[0]).toEqual({
      id: 'a',
      text: 'first echo',
      createdAtIso: '2026-10-18T09:00:00.000Z',
    })
    expect(ECHO_LIMIT).toBe(3)
  })

  it('asks for one more than it shows, so the thought itself can be dropped', () => {
    expect(ECHO_TOP_K).toBe(ECHO_LIMIT + 1)
  })

  it('skips malformed rows instead of inventing text', () => {
    const picked = pickEchoRows(
      [
        null,
        'nope',
        { id: 'x' },
        { id: '', normalizedText: 'no id' },
        { id: 'y', normalizedText: '   ' },
        { id: 'ok', normalizedText: 'fine' },
      ],
      'self',
    )
    expect(picked).toEqual([{ id: 'ok', text: 'fine', createdAtIso: null }])
  })

  it('reads createdAt as an ISO string or a Date; anything else is null', () => {
    const picked = pickEchoRows(
      [
        { id: 'iso', normalizedText: 't', createdAt: '2026-10-18T09:00:00.000Z' },
        { id: 'date', normalizedText: 't', createdAt: new Date('2026-10-17T09:00:00.000Z') },
        { id: 'bad', normalizedText: 't', createdAt: 'not a date' },
        { id: 'num', normalizedText: 't', createdAt: 12345 },
      ],
      'self',
      10,
    )
    expect(picked.map((r) => r.createdAtIso)).toEqual([
      '2026-10-18T09:00:00.000Z',
      '2026-10-17T09:00:00.000Z',
      null,
      null,
    ])
  })

  it('returns nothing for a non-array body', () => {
    expect(pickEchoRows(undefined, 'self')).toEqual([])
    expect(pickEchoRows({ results: [] }, 'self')).toEqual([])
  })
})
