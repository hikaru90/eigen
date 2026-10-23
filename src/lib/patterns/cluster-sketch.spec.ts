import { describe, expect, it } from 'vitest'
import { CLUSTER_SKETCH_NODE_SIZE, clusterSketchLayout } from './cluster-sketch'

describe('clusterSketchLayout', () => {
  it('returns an empty sketch for no ids', () => {
    const sketch = clusterSketchLayout([])
    expect(sketch.nodes).toEqual([])
    expect(sketch.links).toEqual([])
    expect(sketch.bounds.width).toBeGreaterThan(0)
    expect(sketch.bounds.height).toBeGreaterThan(0)
  })

  it('draws one square and no links for a single thought', () => {
    const sketch = clusterSketchLayout(['only'])
    expect(sketch.nodes.length).toBe(1)
    expect(sketch.links).toEqual([])
    expect(sketch.nodes[0].size).toBe(CLUSTER_SKETCH_NODE_SIZE)
  })

  it('links every node to exactly one earlier node — n nodes, n-1 fine center links', () => {
    const sketch = clusterSketchLayout(['a', 'b', 'c', 'd', 'e'])
    expect(sketch.nodes.length).toBe(5)
    expect(sketch.links.length).toBe(4)
    for (const link of sketch.links) {
      expect(link.b).toBeLessThan(link.a)
      expect(link.a).toBeLessThan(5)
    }
  })

  it('is deterministic: same ids in, same sketch out', () => {
    const a = clusterSketchLayout(['a', 'b', 'c'])
    const b = clusterSketchLayout(['a', 'b', 'c'])
    expect(a).toEqual(b)
  })

  it('keeps every square inside the returned bounds', () => {
    const sketch = clusterSketchLayout(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
    for (const node of sketch.nodes) {
      expect(Math.abs(node.x) + node.size / 2).toBeLessThanOrEqual(sketch.bounds.width / 2)
      expect(Math.abs(node.y) + node.size / 2).toBeLessThanOrEqual(sketch.bounds.height / 2)
    }
  })

  it('shapes squares like the mark (corner radius a quarter of the side)', () => {
    const sketch = clusterSketchLayout(['a', 'b'])
    for (const node of sketch.nodes) {
      expect(node.corner).toBeCloseTo(node.size * 0.25)
    }
  })
})
