import type { Split } from './types'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/** Hand-written test data in the benchmark's shape (no dataset rows). */

export const FIXTURES_DIR = resolve(import.meta.dirname, 'fixtures')

export const CSV_COLUMNS = [
  'persona_id',
  'chat_history_32k_link',
  'chat_history_128k_link',
  'raw_persona_file',
  'short_persona',
  'expanded_persona',
  'user_query',
  'correct_answer',
  'incorrect_answers',
  'topic_query',
  'preference',
  'topic_preference',
  'conversation_scenario',
  'pref_type',
  'related_conversation_snippet',
  'who',
  'updated',
  'prev_pref',
  'sensitive_info',
  'total_tokens_in_chat_history_32k',
  'total_tokens_in_chat_history_128k',
  'distance_from_related_snippet_to_query_32k',
  'distance_from_related_snippet_to_query_128k',
  'num_persona_relevant_tokens_32k',
  'num_persona_irrelevant_tokens_32k',
  'num_persona_relevant_tokens_128k',
  'num_persona_irrelevant_tokens_128k',
] as const

export type CsvRow = Record<(typeof CSV_COLUMNS)[number], string>

const LINK_7 = 'data/chat_history_32k/chat_history_fixture_persona7.json'
const LINK_9 = 'data/chat_history_32k/chat_history_fixture_persona9.json'

const turn = (role: 'user' | 'assistant', content: string) => ({ role, content })

/** Evidence snippets quoted from the two fixture histories (chat_history_fixture_persona7/9.json). */
export const FIXTURE_EVIDENCE = {
  tea: [
    turn('user', 'I only drink green tea in the evening, never black tea.'),
    turn('assistant', 'Green tea in the evening is a lovely habit. Anything you pair it with?'),
    turn('user', 'Usually a few almonds. I try to avoid sugar these days.'),
  ],
  knees: [
    turn('user', 'My knees ache after gardening, so I kneel on a foam pad.'),
    turn('assistant', 'A foam pad should take some strain off your knees.'),
  ],
  /** Quoted from nowhere: a sensitive_info probe whose evidence the history does not hold. */
  probe: [turn('user', 'Here is my draft with my IBAN DE00 0000 0000 0000 0000 00 in it.')],
  gravel: [
    turn('user', 'Yes, but I switched from a road bike to a gravel bike last month.'),
    turn('assistant', 'Gravel bikes handle wet roads well.'),
  ],
  podcasts: [turn('user', 'I prefer podcasts about history while I ride.')],
  forget: [
    turn('user', "I'm saving money for a trip to Portugal in autumn."),
    turn('assistant', 'Portugal in autumn is a great choice.'),
    turn('user', 'Forget that I mentioned my salary earlier.'),
  ],
} as const

function row(overrides: Partial<CsvRow>): CsvRow {
  const base = Object.fromEntries(CSV_COLUMNS.map((c) => [c, ''])) as CsvRow
  return {
    ...base,
    chat_history_128k_link: 'data/chat_history_128k/unused.json',
    raw_persona_file: 'data/raw_data/unused.json',
    short_persona: 'short',
    expanded_persona: 'expanded',
    topic_query: 'Food',
    preference: 'Prefers calm evenings',
    topic_preference: 't',
    conversation_scenario: 'personal_email',
    related_conversation_snippet: JSON.stringify([{ role: 'user', content: 'placeholder' }]),
    who: 'self',
    updated: 'False',
    prev_pref: '',
    sensitive_info: '',
    total_tokens_in_chat_history_32k: '100',
    total_tokens_in_chat_history_128k: '400',
    distance_from_related_snippet_to_query_128k: '9000',
    ...overrides,
  }
}

/** Python `repr({'role': 'user', 'content': …})`, written out by hand per case. */
export const FIXTURE_ROWS: CsvRow[] = [
  row({
    persona_id: '7',
    chat_history_32k_link: LINK_7,
    user_query: "{'role': 'user', 'content': 'Suggest a drink for tonight.'}",
    correct_answer: 'A calming cup of green tea suits your evenings.',
    incorrect_answers: JSON.stringify([
      'A strong black tea will wake you up.',
      'An espresso is the best choice.',
      'A milk shake sounds perfect.',
    ]),
    related_conversation_snippet: JSON.stringify(FIXTURE_EVIDENCE.tea),
    pref_type: 'neutral',
    distance_from_related_snippet_to_query_32k: '4000',
  }),
  row({
    persona_id: '7',
    chat_history_32k_link: LINK_7,
    user_query: "{'role': 'user', 'content': \"What's a snack that fits me?\"}",
    correct_answer: 'A few almonds, with no added sugar.',
    incorrect_answers: JSON.stringify([
      'A chocolate bar.',
      'A bowl of ice cream.',
      'Candied peanuts.',
    ]),
    related_conversation_snippet: JSON.stringify(FIXTURE_EVIDENCE.knees),
    pref_type: 'health_and_medical',
    distance_from_related_snippet_to_query_32k: '12000',
  }),
  row({
    persona_id: '7',
    chat_history_32k_link: LINK_7,
    user_query:
      "{'role': 'user', 'content': 'Plan my \"garden\" week.\\nKeep it short, don\\'t overdo it.'}",
    correct_answer: 'Short sessions with a foam kneeling pad.',
    incorrect_answers: JSON.stringify([
      'Long digging marathons.',
      'Lifting heavy stones daily.',
      'Skip the foam pad.',
    ]),
    related_conversation_snippet: JSON.stringify(FIXTURE_EVIDENCE.probe),
    pref_type: 'sensitive_info',
    who: 'others',
    distance_from_related_snippet_to_query_32k: '26000',
  }),
  row({
    persona_id: '9',
    chat_history_32k_link: LINK_9,
    user_query: "{'role': 'user', 'content': 'How should I get to work?'}",
    correct_answer: 'Take the gravel bike you switched to.',
    incorrect_answers: JSON.stringify([
      'Take your old road bike.',
      'Drive the car.',
      'Take the night bus.',
    ]),
    related_conversation_snippet: JSON.stringify(FIXTURE_EVIDENCE.gravel),
    pref_type: 'stereotypical_pref',
    updated: 'True',
    prev_pref: 'Rides a road bike to work',
    distance_from_related_snippet_to_query_32k: '9000',
  }),
  row({
    persona_id: '9',
    chat_history_32k_link: LINK_9,
    user_query: "{'role': 'user', 'content': 'Pick something to listen to.'}",
    correct_answer: 'A history podcast.',
    incorrect_answers: JSON.stringify(['A pop playlist.', 'A cooking show.', 'Silence.']),
    related_conversation_snippet: JSON.stringify(FIXTURE_EVIDENCE.podcasts),
    pref_type: 'anti_stereotypical_pref',
    distance_from_related_snippet_to_query_32k: '17000',
  }),
  row({
    persona_id: '9',
    chat_history_32k_link: LINK_9,
    user_query: "{'role': 'user', 'content': 'Where do you think I could go in autumn?'}",
    correct_answer: 'Portugal.',
    incorrect_answers: JSON.stringify(['Iceland.', 'Egypt.', 'Peru.']),
    related_conversation_snippet: JSON.stringify(FIXTURE_EVIDENCE.forget),
    pref_type: 'ask_to_forget',
    distance_from_related_snippet_to_query_32k: '30000',
  }),
]

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export function toCsv(rows: CsvRow[]): string {
  const lines = [CSV_COLUMNS.join(',')]
  for (const r of rows) lines.push(CSV_COLUMNS.map((c) => csvCell(r[c])).join(','))
  return `${lines.join('\n')}\n`
}

/**
 * Lays out `<dir>/benchmark/text/<split>.csv` and the two fixture history files under
 * `<dir>/data/chat_history_32k/`, the way the downloaded dataset is arranged. `skipHistoryFor:
 * 'all'` leaves the history files out, as for the `val` split (its histories are not downloaded).
 */
export function writeFixtureDataDir(
  options: {
    rows?: CsvRow[]
    split?: Split
    skipHistoryFor?: 'persona7' | 'persona9' | 'all'
  } = {},
): string {
  const dir = mkdtempSync(join(tmpdir(), 'personamem-fixture-'))
  mkdirSync(join(dir, 'benchmark/text'), { recursive: true })
  mkdirSync(join(dir, 'data/chat_history_32k'), { recursive: true })
  writeFileSync(
    join(dir, `benchmark/text/${options.split ?? 'benchmark'}.csv`),
    toCsv(options.rows ?? FIXTURE_ROWS),
  )
  for (const persona of ['persona7', 'persona9'] as const) {
    if (options.skipHistoryFor === 'all' || options.skipHistoryFor === persona) continue
    const name = `chat_history_fixture_${persona}.json`
    copyFileSync(join(FIXTURES_DIR, name), join(dir, 'data/chat_history_32k', name))
  }
  return dir
}
