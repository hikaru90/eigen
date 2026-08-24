import type { EmbeddingSnapshotItem } from '../api/embeddings/snapshot/+server'
import { describe, expect, it } from 'vitest'
import {
  embeddingMapLabelText,
  embeddingMapShouldSuppressSelectionClick,
  screenSpacePointScale,
} from './embedding-map-3d'

function item(overrides: Partial<EmbeddingSnapshotItem> = {}): EmbeddingSnapshotItem {
  return {
    id: 'id-1',
    kind: 'Entity',
    label: 'Short label',
    subtype: 'person',
    embedding: [],
    ...overrides,
  }
}

describe('screenSpacePointScale', () => {
  it('is unity at the reference camera distance', () => {
    expect(screenSpacePointScale(2.4, 2.4)).toBe(1)
  })

  it('shrinks world radius when the camera moves closer', () => {
    expect(screenSpacePointScale(1.2, 2.4)).toBe(0.5)
  })

  it('grows world radius when the camera moves farther', () => {
    expect(screenSpacePointScale(4.8, 2.4)).toBe(2)
  })
})

describe('embeddingMapShouldSuppressSelectionClick', () => {
  it('suppresses click after drag', () => {
    expect(embeddingMapShouldSuppressSelectionClick({ dragged: true })).toBe(true)
    expect(embeddingMapShouldSuppressSelectionClick({ dragged: false })).toBe(false)
  })
})

describe('embeddingMapLabelText', () => {
  it('uses label when present', () => {
    expect(embeddingMapLabelText(item({ label: 'Alice' }))).toBe('Alice')
  })

  it('falls back to id when label is empty', () => {
    expect(embeddingMapLabelText(item({ label: '  ', id: 'ent-42' }))).toBe('ent-42')
  })

  it('truncates long labels like the 2D graph', () => {
    const long = 'a'.repeat(50)
    const out = embeddingMapLabelText(item({ label: long }))
    expect(out).toHaveLength(41)
    expect(out.endsWith('…')).toBe(true)
  })
})
