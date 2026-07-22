import { describe, expect, it } from 'vitest'
import { rowsFromDbExecute } from './execute-rows'

describe('rowsFromDbExecute', () => {
  it('returns postgres-js array results directly', () => {
    const rows = [{ entity_id: 'e1' }]
    expect(rowsFromDbExecute(rows)).toEqual(rows)
  })

  it('unwraps { rows } shaped results', () => {
    expect(rowsFromDbExecute({ rows: [{ entity_id: 'e1' }] })).toEqual([{ entity_id: 'e1' }])
  })

  it('returns empty array for unexpected shapes', () => {
    expect(rowsFromDbExecute(null)).toEqual([])
    expect(rowsFromDbExecute({})).toEqual([])
  })
})
