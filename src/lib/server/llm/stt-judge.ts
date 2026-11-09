import { eq } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { userPreference } from '$lib/server/db/schema'
import { runEnforcedBoundedDecisions } from './decision-plane'

/**
 * Layer 2 of "silence never becomes text" (docs/planning/feature-voice-message-stt.md §8).
 *
 * `qwen/qwen3-asr-0.6b` invents text on quiet or noisy audio that the browser's level check
 * (Layer 1) let through: foreign-script fragments, repeated syllables, subtitle-credit
 * phrases. Whether a transcript is plausibly this user's real dictation is a question about
 * meaning, so it is decided by the Decisions model (surface `transcribe`, kind
 * `transcript_check`) — never by a regex, a script range or a word list, which would also
 * break someone really dictating in Korean, Chinese or Japanese.
 */

export const TRANSCRIPT_CHECK_CRITERIA = {
  dictation:
    'The text is plausibly what this user really said: a coherent utterance in a language the user speaks or writes (including Korean, Chinese or Japanese when those are the user\'s languages), also short, informal, mixed-language or unfinished speech.',
  artefact:
    'The text is more likely an artefact of speech recognition on silence or noise than real speech by this user: a fragment in a script or language the user does not use, repeated syllables or words, a stock subtitle or credit phrase (thanks for watching, subtitles by...), or a stray filler word with no content.',
} as const

const TRANSCRIPT_CHECK_INSTRUCTIONS =
  'A speech recognition model transcribed a voice message from this user. Is the text plausibly real dictation by this user, or an artefact of recognition on silence or noise? A user who really dictates in Korean, Chinese or Japanese must pass when those are among their languages.'

const QUESTION_ID = 'transcript'

/** Deterministic retry policy for ingest dependencies: exactly 3 attempts, then a visible failure. */
export const STT_JUDGE_ATTEMPTS = 3

export type TranscriptVerdict = 'dictation' | 'artefact'

/** What is known about the user's languages; null = nothing on record. */
export type UserSpeechLanguages = {
  /** The language set in settings (`preferredLanguage`). */
  writing: string | null
  /** The interface locale (`preferredUiLocale`). */
  ui: string | null
}

/** Reads the user's language settings. No row = nothing on record (stated to the judge, not defaulted). */
export async function loadUserSpeechLanguages(userId: string): Promise<UserSpeechLanguages> {
  const [row] = await getDb()
    .select({
      writing: userPreference.preferredLanguage,
      ui: userPreference.preferredUiLocale,
    })
    .from(userPreference)
    .where(eq(userPreference.userId, userId))
    .limit(1)
  return { writing: row?.writing ?? null, ui: row?.ui ?? null }
}

/** The Decisions `state`: the languages on record, then the transcript. Never persisted. */
export function buildTranscriptCheckState(input: {
  transcript: string
  languages: UserSpeechLanguages
}): string {
  const { writing, ui } = input.languages
  const known = [
    writing ? `language set in settings: ${writing}` : null,
    ui ? `interface language: ${ui}` : null,
  ].filter((line): line is string => line !== null)
  const languageBlock =
    known.length > 0
      ? `Languages known for this user (codes):\n${known.join('\n')}`
      : 'No language is on record for this user.'
  return `${languageBlock}\n\nTranscript to judge:\n${input.transcript}`
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
  languages: UserSpeechLanguages
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
