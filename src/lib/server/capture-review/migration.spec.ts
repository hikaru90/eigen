import { readFileSync } from 'node:fs'
import { getTableColumns, getTableName } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { captureReview } from '$lib/server/db/schema'

const repoFile = (relative: string) => new URL(`../../../../${relative}`, import.meta.url)

const migrationSql = readFileSync(repoFile('drizzle/0083_capture_review.sql'), 'utf8')
const rlsSql = readFileSync(repoFile('src/lib/server/db/enable_rls.sql'), 'utf8')
const journal = JSON.parse(readFileSync(repoFile('drizzle/meta/_journal.json'), 'utf8')) as {
  entries: Array<{ idx: number; tag: string; version: string; breakpoints: boolean }>
}

describe('0083_capture_review migration', () => {
  it('is journaled in the same change, with the next sequential idx', () => {
    const entry = journal.entries.find((e) => e.tag === '0083_capture_review')
    expect(entry).toBeDefined()
    expect(entry?.idx).toBe(83)
    expect(entry?.version).toBe('7')
    expect(entry?.breakpoints).toBe(true)
    expect(journal.entries.map((e) => e.idx)).toEqual(journal.entries.map((_, i) => i))
  })

  it('creates exactly the columns the Drizzle table declares', () => {
    const columns = Object.values(getTableColumns(captureReview)).map((c) => c.name)
    expect(getTableName(captureReview)).toBe('capture_review')
    expect(columns).toEqual([
      'id',
      'user_id',
      'thought_id',
      'parts',
      'score',
      'status',
      'audit_error',
      'verdict',
      'voted_at',
      'voted_on',
      'reason_encrypted',
      'reason_kind',
      'edit_applied_at',
      'created_at',
      'updated_at',
    ])
    for (const name of columns) {
      expect(migrationSql, `column ${name}`).toContain(`"${name}"`)
    }
  })

  it('keys the review to its thought and tenant, deleting with either', () => {
    expect(migrationSql).toMatch(
      /"user_id" text NOT NULL REFERENCES "user"\("id"\) ON DELETE CASCADE/,
    )
    expect(migrationSql).toMatch(
      /"thought_id" uuid NOT NULL REFERENCES "thought"\("id"\) ON DELETE CASCADE/,
    )
    expect(migrationSql).toMatch(/CONSTRAINT "capture_review_thought_uidx" UNIQUE \("thought_id"\)/)
  })

  it('bounds status, verdict and vote place to their closed values', () => {
    expect(migrationSql).toContain(`"status" IN ('pending_audit', 'scored', 'audit_failed')`)
    expect(migrationSql).toContain(`"verdict" IN ('up', 'down')`)
    expect(migrationSql).toContain(`"voted_on" IN ('capture', 'mesh')`)
  })

  it('isolates tenants by user_id in the migration and in enable_rls.sql', () => {
    for (const sql of [migrationSql, rlsSql]) {
      expect(sql).toMatch(/ALTER TABLE "?capture_review"? ENABLE ROW LEVEL SECURITY/)
      expect(sql).toMatch(/ALTER TABLE "?capture_review"? FORCE ROW LEVEL SECURITY/)
      expect(sql).toMatch(
        /CREATE POLICY capture_review_isolation ON "?capture_review"?\s+FOR ALL\s+USING \(user_id = current_setting\('app\.current_user_id', true\)\)\s+WITH CHECK \(user_id = current_setting\('app\.current_user_id', true\)\)/,
      )
    }
  })
})
