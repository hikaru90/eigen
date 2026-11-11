import { listThoughts } from '$lib/server/capture/service'
import { runEnforcedBoundedDecisions } from './decision-plane'

/**
 * Layer 2 of "silence never becomes text" (docs/planning/feature-voice-message-stt.md §8).
 *
 * `qwen/qwen3-asr-0.6b` invents text on quiet or noisy audio that the browser's level check
 * (Layer 1) let through: foreign-script fragments, repeated syllables, subtitle-credit
 * phrases. Whether a transcript is plausibly this user's real dictation is a question about
 * meaning, so it is decided by the Decisions model (surface `transcribe`, kind
 * `transcript_check`) — never by a regex, a script range or a word list.
 *
 * Evidence for the user's languages is samples of the user's OWN recent writing (the last
 * user-authored thoughts, cut short). The language settings are never sent: they are NOT NULL
 * DEFAULT 'en' and say nothing about the languages a user speaks, so they made every user look
 * English-only. Agent-authored (MCP) thoughts are never samples. No writing on record → the
 * state says so and the judge decides on recognition patterns alone.
 */

export const TRANSCRIPT_CHECK_CRITERIA = {
  dictation:
    "The text is plausibly what this user really said: a coherent utterance, also short, informal, mixed-language or unfinished speech, in a language that fits the user's own writing, or in any language when none of their writing is shown.",
  artefact:
    "The text is more likely an artefact of speech recognition on silence or noise: repeated syllables or words with no content, a stock subtitle or credit phrase (thanks for watching, subtitles by ...), a stray filler word with no content, or a fragment in a language or script that none of the user's own writing uses.",
} as const

export const TRANSCRIPT_CHECK_INSTRUCTIONS =
  "A speech recognition model transcribed a voice message from this user. Is the text plausibly real dictation by this user, or an artefact of recognition on silence or noise? When samples of the user's own recent writing are shown, they show which languages this user uses; they are a sample, not a complete list, and their content is not what is judged."

/** How many of the user's own recent thoughts are shown to the judge. */
export const WRITING_SAMPLE_LIMIT = 6
/** Each sample is cut to this many characters: enough to show the language, no more. */
export const WRITING_SAMPLE_MAX_CHARS = 160

const QUESTION_ID = 'transcript'

/** Deterministic retry policy for ingest dependencies: exactly 3 attempts, then a visible failure. */
export const STT_JUDGE_ATTEMPTS = 3

export type TranscriptVerdict = 'dictation' | 'artefact'

/** The user's own recent writing (decrypted, user-authored only), trimmed and cut short. */
export async function loadUserWritingSamples(userId: string): Promise<string[]> {
  const rows = await listThoughts(userId, {
    fields: 'snippet',
    limit: WRITING_SAMPLE_LIMIT,
    authorFilter: 'user',
  })
  return rows
    .map((row) => (row.normalizedText ?? '').trim())
    .filter((text) => text !== '')
    .map((text) => text.slice(0, WRITING_SAMPLE_MAX_CHARS))
}

/** The Decisions `state`: samples of the user's own writing, then the transcript. Never persisted. */
export function buildTranscriptCheckState(input: {
  transcript: string
  writingSamples: string[]
}): string {
  const writingBlock =
    input.writingSamples.length > 0
      ? `Recent writing by this user (samples):\n${input.writingSamples.map((s) => `- ${s}`).join('\n')}`
      : 'No writing by this user is on record yet.'
  return `${writingBlock}\n\nTranscript to judge:\n${input.transcript}`
}

/**
 * ONE enforced Decisions question about a transcript, retried up to {@link STT_JUDGE_ATTEMPTS}
 * times. Throws when every attempt failed or answered off-catalog: no silent pass. Evidence
 * rows and the one activity row per call are written by the decision plane (choice keys,
 * probabilities and cost — never the transcript).
 */
export async function judgeTranscript(input: {
  userId: string
  transcript: string
  writingSamples: string[]
}): Promise<TranscriptVerdict> {
  const state = buildTranscriptCheckState(input)
  let lastError: unknown
  for (let attempt = 1; attempt <= STT_JUDGE_ATTEMPTS; attempt++) {
    try {
      const answers = await runEnforcedBoundedDecisions({
        userId: input.userId,
        surface: 'transcribe',
        state,
        specs: [
          {
            decisionKind: 'transcript_check',
            id: QUESTION_ID,
            question: {
              type: 'choice',
              instructions: TRANSCRIPT_CHECK_INSTRUCTIONS,
              criteria: TRANSCRIPT_CHECK_CRITERIA,
            },
            llmChoice: null,
          },
        ],
      })
      const choice = answers.get(QUESTION_ID)?.choice
      if (choice !== 'dictation' && choice !== 'artefact') {
        throw new Error('transcript_check answer missing or off-catalog')
      }
      return choice
    } catch (err) {
      lastError = err
      // the message only: the request (and the transcript in it) never reaches a log
      console.error(`[stt-judge] attempt ${attempt}/${STT_JUDGE_ATTEMPTS} failed`, {
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}
