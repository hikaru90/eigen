import { describe, expect, it } from 'vitest'
import { CLUSTER_SKETCH_NODE_SIZE, clusterSketchLayout } from './cluster-sketch'

const graph = (ids: string[], edges: Array<[string, string]> = []) => ({
  nodes: ids.map((id) => ({ id, label: id.toUpperCase(), type: 'concept' })),
  edges: edges.map(([sourceId, targetId]) => ({ sourceId, targetId, predicate: 'related_to' })),
})

describe('clusterSketchLayout', () => {
  it('returns an empty sketch for an empty graph', () => {
    const sketch = clusterSketchLayout(graph([]))
    expect(sketch.nodes).toEqual([])
    expect(sketch.links).toEqual([])
    expect(sketch.bounds.width).toBeGreaterThan(0)
    expect(sketch.bounds.height).toBeGreaterThan(0)
  })

  it('draws one square per graph node, carrying its label', () => {
    const sketch = clusterSketchLayout(graph(['a', 'b']))
    expect(sketch.nodes.map((n) => n.label)).toEqual(['A', 'B'])
    expect(sketch.nodes[0].size).toBe(CLUSTER_SKETCH_NODE_SIZE)
  })

  it('links exactly the graph edges — no invented links', () => {
    const sketch = clusterSketchLayout(graph(['a', 'b', 'c', 'd'], [['a', 'c'], ['d', 'b']]))
    expect(sketch.links).toEqual([
      { a: 0, b: 2 },
      { a: 3, b: 1 },
    ])
    expect(clusterSketchLayout(graph(['a', 'b', 'c'])).links).toEqual([])
  })

  it('drops edges whose ends are not nodes of the graph', () => {
    expect(clusterSketchLayout(graph(['a'], [['a', 'zz']])).links).toEqual([])
  })

  it('is deterministic: same graph in, same sketch out', () => {
    expect(clusterSketchLayout(graph(['a', 'b', 'c'], [['a', 'b']]))).toEqual(
      clusterSketchLayout(graph(['a', 'b', 'c'], [['a', 'b']])),
    )
  })

  it('keeps every square inside the returned bounds', () => {
    const sketch = clusterSketchLayout(graph(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']))
    for (const node of sketch.nodes) {
      expect(Math.abs(node.x) + node.size / 2).toBeLessThanOrEqual(sketch.bounds.width / 2)
      expect(Math.abs(node.y) + node.size / 2).toBeLessThanOrEqual(sketch.bounds.height / 2)
    }
  })

  it('shapes squares like the mark (corner radius a quarter of the side)', () => {
    for (const node of clusterSketchLayout(graph(['a', 'b'])).nodes) {
      expect(node.corner).toBeCloseTo(node.size * 0.25)
    }
  })
})
