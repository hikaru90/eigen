import { describe, expect, it } from 'vitest'
import { filterGraphVizEdgesToNodes, resolveForceLinks } from './sanitize-viz-snapshot'

describe('filterGraphVizEdgesToNodes', () => {
  it('drops edges when an endpoint node is missing', () => {
    const nodes = [{ id: 'a', kind: 'Entity' as const, label: 'A', subtype: 'person' }]
    const edges = [
      {
        id: 'e1',
        sourceId: 'a',
        targetId: '1c995bbf-a909-488e-b9ad-b113adf17fac',
        relationType: 'co_mentioned',
        kind: 'co_mention' as const,
      },
    ]

    const result = filterGraphVizEdgesToNodes(nodes, edges)

    expect(result.edges).toEqual([])
    expect(result.nodes).toEqual(nodes)
  })

  it('keeps edges when both endpoints exist', () => {
    const nodes = [
      { id: 'a', kind: 'Entity' as const, label: 'A', subtype: 'person' },
      { id: 'b', kind: 'Entity' as const, label: 'B', subtype: 'person' },
    ]
    const edges = [
      {
        id: 'e1',
        sourceId: 'a',
        targetId: 'b',
        relationType: 'co_mentioned',
        kind: 'co_mention' as const,
      },
    ]

    const result = filterGraphVizEdgesToNodes(nodes, edges)

    expect(result.edges).toEqual(edges)
  })

  it('matches endpoints case-insensitively', () => {
    const nodes = [
      {
        id: '1C995BBF-A909-488E-B9AD-B113ADF17FAC',
        kind: 'Entity' as const,
        label: 'A',
        subtype: 'person',
      },
    ]
    const edges = [
      {
        id: 'e1',
        sourceId: '1c995bbf-a909-488e-b9ad-b113adf17fac',
        targetId: '1C995BBF-A909-488E-B9AD-B113ADF17FAC',
        relationType: 'self',
        kind: 'co_mention' as const,
      },
    ]

    expect(filterGraphVizEdgesToNodes(nodes, edges).edges).toEqual([])
  })

  it('resolveForceLinks binds node objects and skips missing endpoints', () => {
    const nodes = [{ id: 'a', kind: 'Entity', label: 'A', subtype: 'person' }]
    const links = resolveForceLinks(nodes, [
      {
        id: 'e1',
        sourceId: 'a',
        targetId: '1c995bbf-a909-488e-b9ad-b113adf17fac',
        relationType: 'co_mentioned',
        kind: 'co_mention',
      },
      {
        id: 'e2',
        sourceId: 'a',
        targetId: 'a',
        relationType: 'loop',
        kind: 'co_mention',
      },
    ])

    expect(links).toEqual([])
  })
})
