import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../drizzle')
const journalPath = path.join(migrationsDir, 'meta/_journal.json')

function migrationTagsFromJournal(): string[] {
  const journal = JSON.parse(readFileSync(journalPath, 'utf-8')) as {
    entries: Array<{ tag: string; idx: number }>
  }
  return journal.entries.map((e) => e.tag)
}

function migrationTagsFromDisk(): string[] {
  return readdirSync(migrationsDir)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .map((name) => name.replace(/\.sql$/, ''))
    .sort()
}

describe('drizzle migration journal', () => {
  it('lists every numbered migration SQL file (deploy runs journal entries only)', () => {
    const journalTags = new Set(migrationTagsFromJournal())
    const diskTags = migrationTagsFromDisk()
    const missingFromJournal = diskTags.filter((tag) => !journalTags.has(tag))
    expect(
      missingFromJournal,
      `add to drizzle/meta/_journal.json: ${missingFromJournal.join(', ')}`,
    ).toEqual([])
  })

  it('has a journal entry for every numbered migration SQL file on disk', () => {
    const journalTags = migrationTagsFromJournal()
    const diskTags = new Set(migrationTagsFromDisk())
    const orphanJournal = journalTags.filter((tag) => !diskTags.has(tag))
    expect(
      orphanJournal,
      `missing SQL files for journal tags: ${orphanJournal.join(', ')}`,
    ).toEqual([])
  })

  it('registers 0083_note_passage with the next sequential idx and a note_passage table', () => {
    const journal = JSON.parse(readFileSync(journalPath, 'utf-8')) as {
      entries: Array<{ tag: string; idx: number }>
    }
    const entry = journal.entries.find((e) => e.tag === '0083_note_passage')
    expect(entry).toBeDefined()
    expect(entry!.idx).toBe(83)
    expect(journal.entries.map((e) => e.idx)).toEqual(journal.entries.map((_, i) => i))
    const sqlText = readFileSync(path.join(migrationsDir, '0083_note_passage.sql'), 'utf-8')
    expect(sqlText).toContain('CREATE TABLE IF NOT EXISTS "note_passage"')
    expect(sqlText).toContain('vector(1536)')
    expect(sqlText).toContain('USING hnsw ("embedding" vector_cosine_ops)')
  })

  it('registers 0084_text_file_archived with the next sequential idx and a nullable archived_at column', () => {
    const journal = JSON.parse(readFileSync(journalPath, 'utf-8')) as {
      entries: Array<{ tag: string; idx: number }>
    }
    const entry = journal.entries.find((e) => e.tag === '0084_text_file_archived')
    expect(entry).toBeDefined()
    expect(entry!.idx).toBe(84)
    expect(journal.entries.map((e) => e.idx)).toEqual(journal.entries.map((_, i) => i))
    const sqlText = readFileSync(path.join(migrationsDir, '0084_text_file_archived.sql'), 'utf-8')
    expect(sqlText).toContain('ALTER TABLE "text_file" ADD COLUMN IF NOT EXISTS "archived_at" timestamp')
    // nullable, no default: NULL = active note
    expect(sqlText).not.toMatch(/archived_at"[^;]*NOT NULL/)
  })

  it('registers 0085_user_facts with the next sequential idx and the three fact tables', () => {
    const journal = JSON.parse(readFileSync(journalPath, 'utf-8')) as {
      entries: Array<{ tag: string; idx: number }>
    }
    const entry = journal.entries.find((e) => e.tag === '0085_user_facts')
    expect(entry).toBeDefined()
    expect(entry!.idx).toBe(85)
    expect(journal.entries.map((e) => e.idx)).toEqual(journal.entries.map((_, i) => i))
    const sqlText = readFileSync(path.join(migrationsDir, '0085_user_facts.sql'), 'utf-8')
    expect(sqlText).toContain('CREATE TABLE IF NOT EXISTS "user_secure_value"')
    expect(sqlText).toContain('CREATE TABLE IF NOT EXISTS "user_fact"')
    expect(sqlText).toContain('CREATE TABLE IF NOT EXISTS "user_fact_source"')
    // facts are searched like thoughts: 1536-d cosine HNSW + a generated tsvector over lexical_text
    expect(sqlText).toContain('"embedding" vector(1536) NOT NULL')
    expect(sqlText).toContain('USING hnsw ("embedding" vector_cosine_ops)')
    expect(sqlText).toContain('GENERATED ALWAYS AS (to_tsvector(\'simple\', coalesce("lexical_text", \'\'))) STORED')
    // the statement is stored encrypted only
    expect(sqlText).toContain('"statement_encrypted" text NOT NULL')
  })

  it('keeps the secure value table out of every index: no embedding, no lexical surface', () => {
    const sqlText = readFileSync(path.join(migrationsDir, '0085_user_facts.sql'), 'utf-8')
    const start = sqlText.indexOf('CREATE TABLE IF NOT EXISTS "user_secure_value"')
    const end = sqlText.indexOf(');', start)
    const table = sqlText.slice(start, end)
    expect(table).toContain('"value_encrypted" text NOT NULL')
    expect(table).not.toMatch(/embedding|lexical|tsv|vector/i)
    // nothing may index the secure value table's value
    expect(sqlText).not.toMatch(/INDEX[^;]*"user_secure_value"[^;]*value/i)
  })
})
