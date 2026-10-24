import { describe, expect, it } from 'vitest'
import { PATTERN_GRAPH_MAX_NODES, buildPatternGraph } from './pattern-graph'

const mention = (thoughtId: string, entityId: string, label = entityId) => ({
  thoughtId,
  entityId,
  label,
  type: 'concept',
})

describe('buildPatternGraph', () => {
  it("takes the entities the pattern's thoughts mention, most-mentioned first", () => {
    const graph = buildPatternGraph(
      ['t1', 't2'],
      [mention('t1', 'e-a', 'Alpha'), mention('t2', 'e-b', 'Beta'), mention('t2', 'e-a', 'Alpha'), mention('t9', 'e-x')],
      [],
    )
    expect(graph.nodes).toEqual([
      { id: 'e-a', label: 'Alpha', type: 'concept' },
      { id: 'e-b', label: 'Beta', type: 'concept' },
    ])
  })

  it('keeps only relations between its own nodes, once each', () => {
    const graph = buildPatternGraph(
      ['t1'],
      [mention('t1', 'a'), mention('t1', 'b')],
      [
        { sourceId: 'a', targetId: 'b', predicate: 'works_on' },
        { sourceId: 'a', targetId: 'b', predicate: 'works_on' },
        { sourceId: 'a', targetId: 'outside', predicate: 'knows' },
      ],
    )
    expect(graph.edges).toEqual([{ sourceId: 'a', targetId: 'b', predicate: 'works_on' }])
  })

  it('is empty when the thoughts mention no entity (no stand-in nodes)', () => {
    expect(buildPatternGraph(['t1'], [], [])).toEqual({ nodes: [], edges: [] })
  })

  it(`caps the sketch at ${PATTERN_GRAPH_MAX_NODES} nodes`, () => {
    const many = Array.from({ length: PATTERN_GRAPH_MAX_NODES + 5 }, (_, i) => mention('t1', `e${i}`))
    expect(buildPatternGraph(['t1'], many, []).nodes).toHaveLength(PATTERN_GRAPH_MAX_NODES)
  })
})
