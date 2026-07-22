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
})
