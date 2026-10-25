import { describe, expect, it, vi } from 'vitest'
import { computeLexicalText } from '$lib/server/memory/lexical-text'
import { chunkNoteIntoPassages } from '$lib/server/text-files/chunk-note-passages'
import { envPaste, FAKE_SECRETS, leaks } from '$lib/test/secret-fixtures'
import { redactSecrets } from './detect-secrets'
import { noteIndexSurfaces } from './note-secrets'
import {
  planNoteScrub,
  planThoughtScrub,
  runStoredSecretScrub,
  type ScrubNote,
  type ScrubStore,
  type ScrubThought,
} from './scrub-stored-secrets'

const CLEAN_THOUGHT: ScrubThought = {
  id: 't-clean',
  rawText: 'buy oat milk, commit 9f3a2c1',
  normalizedText: 'buy oat milk, commit 9f3a2c1',
  askQuestion: 'What do I need to buy?',
  cues: ['oat milk'],
  metadata: { pipeline: 'ontology_llm_v1' },
  entities: [{ entityId: 'e-milk', label: 'oat milk' }],
}

/** The evidence-run thought: verbatim .env paste stored, enriched into entities and a cue. */
const LEAKY_THOUGHT: ScrubThought = {
  id: 't-env',
  rawText: envPaste(),
  normalizedText: envPaste(),
  askQuestion: 'What is my DATABASE_URL set to?',
  cues: ['database url', `LLM_API_KEY ${FAKE_SECRETS.openai}`],
  metadata: { preview: { interpretedText: envPaste() }, pipeline: 'ontology_llm_v1' },
  entities: [
    { entityId: 'e-key-name', label: 'LLM_API_KEY' },
    { entityId: 'e-url', label: `postgres://user:${FAKE_SECRETS.urlPassword}@localhost:5432/mydb` },
    { entityId: 'e-key', label: FAKE_SECRETS.openai },
  ],
}

const LEAKY_BODY = `step 1\n${envPaste()}`
/** A note indexed before secret hygiene: lexical text and passages were built from the verbatim body. */
const LEAKY_NOTE: ScrubNote = {
  id: 'n-1',
  title: 'Runbook',
  body: LEAKY_BODY,
  lexicalText: computeLexicalText(`Runbook ${LEAKY_BODY}`),
  passages: [LEAKY_BODY],
}
const CLEAN_NOTE: ScrubNote = {
  id: 'n-2',
  title: 'Groceries',
  body: 'eggs, milk',
  lexicalText: computeLexicalText('Groceries eggs, milk'),
  passages: ['eggs, milk'],
}

function fakeStore(): ScrubStore & {
  appliedThoughts: Array<{ userId: string; plan: ReturnType<typeof planThoughtScrub> }>
  appliedNotes: Array<{ userId: string; noteId: string }>
} {
  const appliedThoughts: Array<{ userId: string; plan: ReturnType<typeof planThoughtScrub> }> = []
  const appliedNotes: Array<{ userId: string; noteId: string }> = []
  return {
    appliedThoughts,
    appliedNotes,
    listUserIds: vi.fn(async () => ['u1', 'u2']),
    loadThoughts: vi.fn(async (userId: string) =>
      userId === 'u1' ? [CLEAN_THOUGHT, LEAKY_THOUGHT] : [CLEAN_THOUGHT],
    ),
    loadNotes: vi.fn(async (userId: string) => (userId === 'u1' ? [LEAKY_NOTE, CLEAN_NOTE] : [])),
    applyThoughtScrub: vi.fn(async (userId: string, plan) => {
      appliedThoughts.push({ userId, plan })
    }),
    applyNoteScrub: vi.fn(async (userId: string, plan) => {
      appliedNotes.push({ userId, noteId: plan.noteId })
    }),
  }
}

describe('planThoughtScrub', () => {
  it('plans nothing for a clean thought, and nothing again once a plan has been applied (idempotent)', () => {
    expect(planThoughtScrub(CLEAN_THOUGHT)).toBeNull()
    const plan = planThoughtScrub(LEAKY_THOUGHT)!
    const scrubbed: ScrubThought = {
      ...LEAKY_THOUGHT,
      normalizedText: plan.normalizedText,
      askQuestion: plan.askQuestion,
      cues: plan.cues,
      metadata: plan.metadata,
      entities: LEAKY_THOUGHT.entities.filter((e) => !plan.dropEntityIds.includes(e.entityId)),
      // raw_text is the verbatim original and is never rewritten: it keeps the secret
    }
    expect(planThoughtScrub(scrubbed)).toBeNull()
  })

  it('re-derives every text surface from redacted text and never touches raw_text', () => {
    const plan = planThoughtScrub(LEAKY_THOUGHT)!
    expect(plan.thoughtId).toBe('t-env')
    expect(plan).not.toHaveProperty('rawText')
    expect(
      leaks(JSON.stringify([plan.normalizedText, plan.askQuestion, plan.cues, plan.metadata])),
    ).toBe(false)
    expect(plan.normalizedText).toContain('LLM_API_KEY=[redacted secret]')
    expect(plan.cues).toEqual(['database url', 'LLM_API_KEY [redacted secret]'])
    // the .env paste (connection string + the key assigned to LLM_API_KEY), plus the same key
    // as the enrichment cue quoted it without its variable name
    expect(plan.metadata.secretsRedacted).toEqual([
      { kind: 'connection_string', name: null },
      { kind: 'api_key', name: 'LLM_API_KEY' },
      { kind: 'api_key', name: 'openai' },
    ])
  })

  it('drops graph entities whose label holds a secret value, keeps entities that merely name a credential', () => {
    const plan = planThoughtScrub(LEAKY_THOUGHT)!
    expect(plan.dropEntityIds.sort()).toEqual(['e-key', 'e-url'])
  })

  it('does not plan a thought whose derived surfaces are clean even though raw_text holds the original', () => {
    expect(
      planThoughtScrub({
        ...CLEAN_THOUGHT,
        id: 't-raw-only',
        rawText: `token ${FAKE_SECRETS.githubClassic}`,
        normalizedText: 'token [redacted secret]',
      }),
    ).toBeNull()
  })
})

describe('planNoteScrub', () => {
  it('plans a note whose index was built from a body holding a secret, and leaves a clean one alone', () => {
    expect(planNoteScrub(CLEAN_NOTE)).toBeNull()
    const plan = planNoteScrub(LEAKY_NOTE)!
    expect(plan.noteId).toBe('n-1')
    expect(plan.findings.map((f) => f.kind)).toEqual(['connection_string', 'api_key'])
    expect(JSON.stringify(plan).includes(FAKE_SECRETS.openai)).toBe(false)
  })

  it('is idempotent: once lexical text and passages come from the redacted body there is nothing to do', () => {
    const { passageBody, lexicalText } = noteIndexSurfaces('Runbook', LEAKY_BODY)
    expect(
      planNoteScrub({
        ...LEAKY_NOTE, // the body stays verbatim: the user saved it
        lexicalText,
        passages: chunkNoteIntoPassages(passageBody).map((p) => p.text),
      }),
    ).toBeNull()
  })

  it('plans a note indexed with bare placeholders: its passages must carry numbered ones (Part 2)', () => {
    const redactedBody = redactSecrets(LEAKY_BODY).text
    const plan = planNoteScrub({
      ...LEAKY_NOTE,
      lexicalText: computeLexicalText(`Runbook ${redactedBody}`),
      passages: [redactedBody],
    })
    expect(plan).not.toBeNull()
    expect(plan!.noteId).toBe('n-1')
  })

  it('plans a note whose passages still hold a secret even when its lexical text is already clean', () => {
    const redactedBody = redactSecrets(LEAKY_BODY).text
    expect(
      planNoteScrub({
        ...LEAKY_NOTE,
        lexicalText: computeLexicalText(`Runbook ${redactedBody}`),
        passages: [LEAKY_BODY],
      }),
    ).not.toBeNull()
  })
})

describe('runStoredSecretScrub', () => {
  it('dry-run (the default) reports what it would change and writes nothing', async () => {
    const store = fakeStore()
    const report = await runStoredSecretScrub(store, { apply: false })

    expect(report).toEqual(
      expect.objectContaining({
        apply: false,
        usersScanned: 2,
        thoughtsScanned: 3,
        thoughtsWithSecrets: 1,
        notesScanned: 2,
        notesWithSecrets: 1,
        entitiesToDrop: 2,
        failed: 0,
      }),
    )
    expect(store.applyThoughtScrub).not.toHaveBeenCalled()
    expect(store.applyNoteScrub).not.toHaveBeenCalled()
  })

  it('the report names ids, kinds and credential names, never a value', async () => {
    const report = await runStoredSecretScrub(fakeStore(), { apply: false })
    expect(report.thoughts).toEqual([expect.objectContaining({ userId: 'u1', thoughtId: 't-env' })])
    expect(report.byKind).toEqual({ connection_string: 2, api_key: 3 })
    expect(leaks(JSON.stringify(report))).toBe(false)
    expect(JSON.stringify(report).includes(FAKE_SECRETS.urlPassword)).toBe(false)
  })

  it('--apply hands each affected thought and note to the store, with redacted payloads only', async () => {
    const store = fakeStore()
    const report = await runStoredSecretScrub(store, { apply: true })

    expect(report.apply).toBe(true)
    expect(store.appliedThoughts).toHaveLength(1)
    expect(store.appliedThoughts[0]!.userId).toBe('u1')
    expect(leaks(JSON.stringify(store.appliedThoughts[0]!.plan))).toBe(false)
    expect(store.appliedNotes).toEqual([{ userId: 'u1', noteId: 'n-1' }])
    expect(report.thoughtsScrubbed).toBe(1)
    expect(report.notesScrubbed).toBe(1)
  })

  it('restricts to one tenant with userId', async () => {
    const store = fakeStore()
    const report = await runStoredSecretScrub(store, { apply: false, userId: 'u2' })
    expect(report.usersScanned).toBe(1)
    expect(report.thoughtsWithSecrets).toBe(0)
  })

  it('keeps going when one item fails, reports it without the value, and counts it', async () => {
    const store = fakeStore()
    ;(store.applyThoughtScrub as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('embedding gateway down'),
    )
    const report = await runStoredSecretScrub(store, { apply: true })

    expect(report.failed).toBe(1)
    expect(report.failures).toEqual([
      { userId: 'u1', kind: 'thought', id: 't-env', message: 'embedding gateway down' },
    ])
    // the note after the failed thought still ran
    expect(store.appliedNotes).toHaveLength(1)
  })
})
