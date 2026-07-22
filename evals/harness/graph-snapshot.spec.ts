import { describe, expect, it } from 'vitest'
import { labelEvalGraphNodes } from './graph-snapshot'

describe('labelEvalGraphNodes', () => {
  it('prefixes Thought labels with fixture id when mapped', () => {
    const nodes = labelEvalGraphNodes(
      [
        { id: 't1', kind: 'Thought', label: 'Sarah prefers email', subtype: 'observation' },
        { id: 'e1', kind: 'Entity', label: 'Sarah', subtype: 'person' },
      ],
      new Map([['t1', 'ec_sarah_contact']]),
    )
    expect(nodes[0]!.label).toBe('ec_sarah_contact · Sarah prefers email')
    expect(nodes[1]!.label).toBe('Sarah')
  })

  it('does not double-prefix when label already includes fixture id', () => {
    const nodes = labelEvalGraphNodes(
      [
        {
          id: 't1',
          kind: 'Thought',
          label: 'ec_sarah_contact · Sarah prefers email',
          subtype: 'observation',
        },
      ],
      new Map([['t1', 'ec_sarah_contact']]),
    )
    expect(nodes[0]!.label).toBe('ec_sarah_contact · Sarah prefers email')
  })
})
