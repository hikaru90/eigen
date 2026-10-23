/**
 * MISSING PARAGLIDE KEYS — board copy pending the sweep wave.
 *
 * The wave-1 inventory (docs/planning/ei-redesign.md) created only
 * `better.tabs.*`, `better.composer_placeholder`, `better.share` and
 * `better.votes_left`. Everything else the board says had no key and no
 * existing key with the right meaning, so it lives here — one file, each string
 * annotated with the key it should become — rather than being wired to a wrong
 * key or scattered through components. The sweep wave lifts these into
 * `messages/en.json` + `messages/de.json` (de in the ei voice) and replaces this
 * module with `m.*` calls. Until then the board reads English in both locales.
 *
 * Vocabulary and tone follow DESIGN.md "Make me better"; nothing here is a
 * fixture sentence copied verbatim from the ei prototype's sample data.
 */
export const betterCopy = {
  /** better.back — the own-row "← Back" */
  back: 'Back',
  /** better.most_wanted */
  mostWanted: 'Most wanted',
  /** better.from_the_makers */
  fromTheMakers: 'From the makers',
  /** better.area_everywhere */
  everywhere: 'Everywhere',
  /** better.kind_idea / better.kind_bug / better.kind_polish */
  kind: { idea: 'Idea', bug: 'Bug', polish: 'Polish' } as const,
  /** better.reading_kind_idea / _bug / _polish — "Sounds like *a bug* in …" */
  kindPhrase: { idea: 'an idea', bug: 'a bug', polish: 'a bit of polish' } as const,
  /** better.reading_in — the word between kind and area */
  readingIn: 'in',
  /** better.reading_everywhere — the area phrase when nothing narrower fits */
  readingEverywhere: 'all of Eigenmesh',
  /** better.similar_heading */
  similarHeading: 'Someone had a similar thought',
  /** better.vote_instead */
  voteInstead: 'Vote for it instead',
  /** better.already_voted */
  alreadyVoted: 'You’ve voted for it',
  /** better.mines_different */
  minesDifferent: 'Mine’s different',
  /** better.vote_for_this — vote control, not yet yours */
  voteForThis: 'Vote for this',
  /** better.take_vote_back — vote control, yours */
  takeVoteBack: 'Take your vote back',
  /** better.votes_word — "{n} votes" in the vote control's label and the chorus card */
  votes: 'votes',
  /** better.including_yours */
  includingYours: 'including yours',
  /** better.thanks_to / better.and / better.others / better.you — "Thanks to Noor, you, and 180 others" */
  thanksTo: 'Thanks to',
  and: 'and',
  others: 'others',
  you: 'you',
  /** better.you_asked — shipped rows you voted for */
  youAsked: 'You asked for this. Your vote came back to you.',
  /** better.shared_by_you — rows you shared */
  sharedByYou: 'Shared by you · the makers have it, and you’ll hear back here',
  /** better.note_welcome — the clay dot's note, sticky until dismissed */
  welcome:
    'Hey — I’m still learning to be the right place for your thoughts. Tell me what’s missing or what’s broken, and help me get better.',
  /** better.voted_with — {count} others */
  votedWith: (others: number) => `You voted with ${others} others. Together you’re louder.`,
  /** better.vote_taken_back */
  voteTakenBack: 'Vote taken back.',
  /** better.votes_exhausted */
  votesExhausted: 'You’ve used all 10 votes this month. Take one back to vote for something else.',
  /** better.shared_thanks */
  sharedThanks:
    'Thank you. It’s on the board — the makers read everything, and you’ll hear back right here.',
  /** better.share_failed — followed by the server's reason */
  shareFailed: 'That didn’t reach the makers.',
} as const
