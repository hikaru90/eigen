/**
 * Forget one detail inside a note (docs/planning/personamem-score-plan.md, S2b). The note search
 * hit names the matched passages; this rewrites just their window (the matched passages plus the
 * neighbours the hit showed, so a long note is never sent whole), splices the rewrite back into
 * the note and saves it through the text-file service as an agent write: passages and their
 * embeddings rebuild, and the `[redacted secret #n]` placeholders the model was shown are
 * restored to the note's stored secrets (docs/planning/secret-hygiene.md, Part 2). The model sees
 * no credential; the stored body keeps every secret the removal did not touch.
 *
 * What counts as "the detail" is the model's judgement; splicing and saving are mechanical.
 */

import { evictOnReject } from '$lib/server/llm/eval-llm-cache'
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client'
import { parseLlmJsonPayload } from '$lib/server/memory/llm-json-content'
import { extractChatContent } from '$lib/server/ontology/llm-json'
import { numberNoteSecrets } from '$lib/server/security/note-secrets'
import { NOTE_PASSAGE_NEIGHBOR_RADIUS, windowOrdinals } from '$lib/server/text-files/merge-note-passage-hits'
import { loadStoredPassages } from '$lib/server/text-files/note-passages'
import { archiveTextFile, getTextFile, updateTextFile } from '$lib/server/text-files/service'

export const REMOVE_NOTE_DETAIL_PROMPT = [
  'You edit regions of a user\'s note so that one detail is forgotten. You get the detail to remove and one or more regions of the note. Return JSON only — no markdown fences.',
  '',
  'Return exactly: {"regions":[{"region":"<ref>","text":"<the region without the detail>"}, ...]} with every region (r1, r2, ...) exactly once.',
  '',
  'Remove only the forgotten detail: the sentences or clauses that state it. Keep everything else of the region exactly as written, character for character: wording, line breaks, punctuation, the region\'s language, and every placeholder such as [redacted secret #n] (copy placeholders unchanged).',
  'If a region holds nothing but the detail, return an empty string for it. If a region does not contain the detail, return it unchanged.',
  'Do not add, summarise, translate or comment. Judge what the detail covers by meaning in any language.',
].join('\n')

type Region = { ref: string; start: number; end: number }

/** Parses the rewrite reply: every region exactly once, text a string (empty = region removed). */
export function parseRegionRewrites(text: string, refs: string[]): Map<string, string> {
  const parsed = parseLlmJsonPayload(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('note detail removal: response is not a JSON object')
  }
  const list = (parsed as { regions?: unknown }).regions
  if (!Array.isArray(list)) {
    throw new Error('note detail removal: regions must be an array')
  }
  const expected = new Set(refs)
  const out = new Map<string, string>()
  for (const entry of list) {
    const { region, text: rewritten } = (entry ?? {}) as { region?: unknown; text?: unknown }
    if (typeof region !== 'string' || !expected.has(region)) {
      throw new Error(`note detail removal: unknown region "${String(region)}"`)
    }
    if (out.has(region)) {
      throw new Error(`note detail removal: region ${region} returned more than once`)
    }
    if (typeof rewritten !== 'string') {
      throw new Error(`note detail removal: text for region ${region} must be a string`)
    }
    out.set(region, rewritten)
  }
  for (const ref of refs) {
    if (!out.has(ref)) throw new Error(`note detail removal: no text for region ${ref}`)
  }
  return out
}

/**
 * edited = the note was rewritten · archived = the removal left nothing of an untitled note ·
 * gone = the note is not an active note any more (archived or deleted since retrieval).
 */
export type RemoveNoteDetailOutcome = 'edited' | 'archived' | 'gone'

export async function removeDetailFromNote(input: {
  userId: string
  noteId: string
  detail: string
  /** The passages the search hit matched; their neighbours come with them. */
  matchedOrdinals: number[]
}): Promise<RemoveNoteDetailOutcome> {
  const { userId, noteId } = input
  const note = await getTextFile(userId, noteId)
  if (!note) return 'gone'

  const numbered = numberNoteSecrets(note.body)
  const passages = new Map((await loadStoredPassages(userId, noteId)).map((p) => [p.ordinal, p]))
  const wanted = windowOrdinals(input.matchedOrdinals, NOTE_PASSAGE_NEIGHBOR_RADIUS).filter((o) =>
    passages.has(o),
  )
  if (wanted.length === 0) {
    throw new Error(`forget: note ${noteId} has no stored passage for the matched excerpt (stale index)`)
  }
  for (const ordinal of wanted) {
    const passage = passages.get(ordinal)!
    if (numbered.slice(passage.startChar, passage.endChar) !== passage.text) {
      throw new Error(`forget: note ${noteId} passage ${ordinal} no longer matches the note body (stale index)`)
    }
  }

  // contiguous runs of passages become one region each
  const regions: Region[] = []
  let runStart = wanted[0]!
  for (let i = 1; i <= wanted.length; i++) {
    if (i < wanted.length && wanted[i] === wanted[i - 1]! + 1) continue
    const first = passages.get(runStart)!
    const last = passages.get(wanted[i - 1]!)!
    regions.push({ ref: `r${regions.length + 1}`, start: first.startChar, end: last.endChar })
    runStart = wanted[i]!
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: REMOVE_NOTE_DETAIL_PROMPT },
    {
      role: 'user',
      content: `Detail to remove: ${input.detail}\n\n${regions
        .map(
          (r) =>
            `<<<region ${r.ref}>>>\n${numbered.slice(r.start, r.end)}\n<<</region>>>`,
        )
        .join('\n\n')}`,
    },
  ]
  const raw = await llmChatCompletion({
    userId,
    messages,
    temperature: 0,
    responseFormat: 'json_object',
    logContext: 'forget_note_edit',
  })
  const rewrites = evictOnReject(raw, () => {
    const content = extractChatContent(raw).trim()
    if (!content) {
      throw new Error('note detail removal: empty LLM response')
    }
    return parseRegionRewrites(
      content,
      regions.map((r) => r.ref),
    )
  })

  if (regions.every((r) => rewrites.get(r.ref) === numbered.slice(r.start, r.end))) {
    // the detail would still be remembered: fail loud, the retry ladder asks the model again
    throw new Error(`forget: note ${noteId} edit left the note unchanged`)
  }
  let next = numbered
  for (const r of [...regions].reverse()) {
    next = next.slice(0, r.start) + rewrites.get(r.ref)! + next.slice(r.end)
  }

  if (next.trim() === '' && note.title.trim() === '') {
    // nothing of the note is left to keep: an untitled empty note is not valid, so it is archived
    if (!(await archiveTextFile(userId, noteId))) return 'gone'
    return 'archived'
  }
  const saved = await updateTextFile(userId, noteId, { body: next }, { agentWrite: true })
  return saved ? 'edited' : 'gone'
}
