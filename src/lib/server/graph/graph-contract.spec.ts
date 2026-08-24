import { describe, expect, it } from 'vitest'
import * as graphAdapter from './age'
import { GRAPH_ADAPTER_OPERATIONS } from './graph-contract'

describe('graph adapter contract', () => {
  it('exports every operation from the runtime adapter module', () => {
    for (const op of GRAPH_ADAPTER_OPERATIONS) {
      expect(typeof graphAdapter[op]).toBe('function')
    }
  })
})
