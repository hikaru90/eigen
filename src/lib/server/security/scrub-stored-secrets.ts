/**
 * Scrub secrets that were stored before secret hygiene existed (docs/planning/secret-hygiene.md,
 * Design 5). Pure planning + a small runner over an injected store, so the logic is tested on
 * fixtures; the database-backed store and the CLI live in `scripts/scrub-stored-secrets.ts`.
 *
 * What a scrub does and does not touch:
 * - `thought.raw_text` and a note's saved body are the user's verbatim words and are NEVER rewritten.
 * - Everything DERIVED from them is re-derived from the redacted text: `normalized_text`, lexical
 *   text, the embedding, cues, the Ask question, metadata strings, note lexical text and passages.
 * - Graph entities whose own label holds a secret value (or the redaction marker) are dropped.
 *   An entity that merely names a credential (`LLM_API_KEY`) is kept: remembering THAT a credential
 *   exists is allowed, only its value is not.
 *
 * Dry-run is the default. Reports carry ids, kinds and credential names — never a value.
 */
import { computeLexicalText } from '$lib/server/memory/lexical-text'
import {
  redactSecrets,
  redactSecretsDeep,
  SECRET_PLACEHOLDER,
  summarizeRedactedSecrets,
  type RedactedSecretSummary,
  type SecretFinding,
} from '$lib/server/security/detect-secrets'

export type ScrubThought = {
  id: string
  /** The user's verbatim words: scanned for the report, never rewritten. */
  rawText: string
  normalizedText: string
  askQuestion: string | null
  cues: string[]
  metadata: Record<string, unknown>
  /** Canonical entities this thought is linked to. */
  entities: Array<{ entityId: string; label: string }>
}

export type ThoughtScrubPlan = {
  thoughtId: string
  normalizedText: string
  askQuestion: string | null
  cues: string[]
  /** Metadata with every string redacted, plus the merged `secretsRedacted` summary. */
  metadata: Record<string, unknown>
  /** Entities linked to this thought whose label holds a secret value or the redaction marker. */
  dropEntityIds: string[]
  findings: RedactedSecretSummary[]
}

export type ScrubNote = {
  id: string
  title: string
  /** The body the user saved: scanned, never rewritten. */
  body: string
  /** Stored `lexical_text` of the note. */
  lexicalText: string
  /** Stored passage texts (decrypted). */
  passages: string[]
}

export type NoteScrubPlan = {
  noteId: string
  findings: RedactedSecretSummary[]
}

export type ScrubStore = {
  listUserIds(): Promise<string[]>
  loadThoughts(userId: string): Promise<ScrubThought[]>
  loadNotes(userId: string): Promise<ScrubNote[]>
  applyThoughtScrub(userId: string, plan: ThoughtScrubPlan): Promise<void>
  applyNoteScrub(userId: string, plan: NoteScrubPlan): Promise<void>
}

function hasSecret(text: string): boolean {
  return redactSecrets(text).findings.length > 0
}

function findingsOf(texts: string[]): SecretFinding[] {
  return texts.flatMap((text) => redactSecrets(text).findings)
}

/** Every string inside a JSON-like value. */
function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(stringsIn)
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(stringsIn)
  return []
}

/**
 * A thought needs a scrub when a DERIVED surface (normalized text, Ask question, cues, metadata,
 * an entity label) holds a secret. `raw_text` alone does not trigger one: it is allowed to keep
 * the original, so it would re-trigger forever.
 */
export function planThoughtScrub(thought: ScrubThought): ThoughtScrubPlan | null {
  const derived = [
    thought.normalizedText,
    ...(thought.askQuestion === null ? [] : [thought.askQuestion]),
    ...thought.cues,
    ...stringsIn(thought.metadata),
  ]
  const dropEntityIds = thought.entities
    .filter((entity) => hasSecret(entity.label) || entity.label.includes(SECRET_PLACEHOLDER))
    .map((entity) => entity.entityId)
  if (!derived.some(hasSecret) && dropEntityIds.length === 0) return null

  const priorSummary = Array.isArray(thought.metadata.secretsRedacted)
    ? (thought.metadata.secretsRedacted as RedactedSecretSummary[])
    : []
  const findings = summarizeRedactedSecrets([
    ...findingsOf([thought.rawText, ...derived]),
    ...priorSummary.map((entry, index) => ({
      kind: entry.kind,
      name: entry.name,
      start: index,
      end: index,
    })),
  ])
  const metadata = redactSecretsDeep({ ...thought.metadata })
  if (findings.length > 0) metadata.secretsRedacted = findings

  return {
    thoughtId: thought.id,
    normalizedText: redactSecrets(thought.normalizedText).text,
    askQuestion: thought.askQuestion === null ? null : redactSecrets(thought.askQuestion).text,
    cues: thought.cues.map((cue) => redactSecrets(cue).text),
    metadata,
    dropEntityIds,
    findings,
  }
}

/**
 * A note needs a scrub when its saved title/body hold a secret AND its index (lexical text or a
 * passage) was built from it. After a scrub the index matches the redacted body, so the plan is
 * null again while the body itself stays verbatim.
 */
export function planNoteScrub(note: ScrubNote): NoteScrubPlan | null {
  const title = redactSecrets(note.title)
  const body = redactSecrets(note.body)
  const findings = [...title.findings, ...body.findings]
  if (findings.length === 0) return null

  const expectedLexical = computeLexicalText(`${title.text} ${body.text}`)
  const indexIsStale = note.lexicalText !== expectedLexical || note.passages.some(hasSecret)
  if (!indexIsStale) return null
  return { noteId: note.id, findings: summarizeRedactedSecrets(findings) }
}

export type ScrubReport = {
  apply: boolean
  usersScanned: number
  thoughtsScanned: number
  thoughtsWithSecrets: number
  thoughtsScrubbed: number
  notesScanned: number
  notesWithSecrets: number
  notesScrubbed: number
  entitiesToDrop: number
  failed: number
  /** Count of redacted credentials per kind, over all planned thoughts and notes. */
  byKind: Record<string, number>
  thoughts: Array<{
    userId: string
    thoughtId: string
    findings: RedactedSecretSummary[]
    dropEntityIds: string[]
  }>
  notes: Array<{ userId: string; noteId: string; findings: RedactedSecretSummary[] }>
  failures: Array<{ userId: string; kind: 'thought' | 'note'; id: string; message: string }>
}

function countKinds(into: Record<string, number>, findings: RedactedSecretSummary[]): void {
  for (const { kind } of findings) into[kind] = (into[kind] ?? 0) + 1
}

/**
 * Plans (always) and applies (only with `apply: true`) the scrub over every tenant, or one with
 * `userId`. A failing item is recorded and the run continues; callers exit non-zero on `failed`.
 */
export async function runStoredSecretScrub(
  store: ScrubStore,
  options: { apply: boolean; userId?: string },
): Promise<ScrubReport> {
  const userIds = options.userId ? [options.userId] : await store.listUserIds()
  const report: ScrubReport = {
    apply: options.apply,
    usersScanned: userIds.length,
    thoughtsScanned: 0,
    thoughtsWithSecrets: 0,
    thoughtsScrubbed: 0,
    notesScanned: 0,
    notesWithSecrets: 0,
    notesScrubbed: 0,
    entitiesToDrop: 0,
    failed: 0,
    byKind: {},
    thoughts: [],
    notes: [],
    failures: [],
  }

  for (const userId of userIds) {
    for (const thought of await store.loadThoughts(userId)) {
      report.thoughtsScanned += 1
      const plan = planThoughtScrub(thought)
      if (!plan) continue
      report.thoughtsWithSecrets += 1
      report.entitiesToDrop += plan.dropEntityIds.length
      countKinds(report.byKind, plan.findings)
      report.thoughts.push({
        userId,
        thoughtId: plan.thoughtId,
        findings: plan.findings,
        dropEntityIds: plan.dropEntityIds,
      })
      if (!options.apply) continue
      try {
        await store.applyThoughtScrub(userId, plan)
        report.thoughtsScrubbed += 1
      } catch (err) {
        report.failed += 1
        report.failures.push({
          userId,
          kind: 'thought',
          id: plan.thoughtId,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }

    for (const note of await store.loadNotes(userId)) {
      report.notesScanned += 1
      const plan = planNoteScrub(note)
      if (!plan) continue
      report.notesWithSecrets += 1
      countKinds(report.byKind, plan.findings)
      report.notes.push({ userId, noteId: plan.noteId, findings: plan.findings })
      if (!options.apply) continue
      try {
        await store.applyNoteScrub(userId, plan)
        report.notesScrubbed += 1
      } catch (err) {
        report.failed += 1
        report.failures.push({
          userId,
          kind: 'note',
          id: plan.noteId,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }
  return report
}
