import { describe, expect, it } from 'vitest'
import { GRAPH_ADAPTER_OPERATIONS } from './graph-contract'
import * as graphAdapter from './age'

describe('graph adapter contract', () => {
  it('exports every operation from the runtime adapter module', () => {
    for (const op of GRAPH_ADAPTER_OPERATIONS) {
      expect(typeof graphAdapter[op]).toBe('function')
    }
  })
})
