import { describe, expect, it } from 'vitest'
import {
  AGE_EDGE_LABELS,
  AGE_VERTEX_LABELS,
  buildAgeGraphLabelsAndIndexesSql,
} from './age-graph-labels.mjs'

describe('buildAgeGraphLabelsAndIndexesSql', () => {
  const sql = buildAgeGraphLabelsAndIndexesSql('eigen_graph')

  it('creates every vertex and edge label idempotently', () => {
    for (const label of AGE_VERTEX_LABELS) {
      expect(sql).toContain(`ag_catalog.create_vlabel('eigen_graph', '${label}')`)
    }
    for (const label of AGE_EDGE_LABELS) {
      expect(sql).toContain(`ag_catalog.create_elabel('eigen_graph', '${label}')`)
    }
    expect(sql).toContain('IF NOT EXISTS')
  })

  it('creates a user_id btree index for every label', () => {
    for (const label of [...AGE_VERTEX_LABELS, ...AGE_EDGE_LABELS]) {
      const slug = label.toLowerCase()
      expect(sql).toContain(`CREATE INDEX IF NOT EXISTS "${slug}_user_id_idx"`)
      expect(sql).toContain(`ON "eigen_graph"."${label}"`)
    }
  })

  it('creates a composite user_id,id index only for vertex labels', () => {
    for (const label of AGE_VERTEX_LABELS) {
      const slug = label.toLowerCase()
      expect(sql).toContain(`CREATE INDEX IF NOT EXISTS "${slug}_user_id_id_idx"`)
    }
    for (const label of AGE_EDGE_LABELS) {
      const slug = label.toLowerCase()
      expect(sql).not.toContain(`"${slug}_user_id_id_idx"`)
    }
  })

  it('indexes the user_id property via agtype_access_operator', () => {
    expect(sql).toContain(`ag_catalog.agtype_access_operator(properties, '"user_id"'::agtype)`)
  })
})
