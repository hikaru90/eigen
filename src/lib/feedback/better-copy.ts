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
  /** better.vote_up / better.vote_down — the two vote controls */
  voteUp: 'Vote up',
  voteDown: 'Vote down',
  /** better.take_vote_back — tapping your current direction again */
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
  /** better.shared_by_you — rows you shared */
  sharedByYou: 'Shared by you · the makers have it, and you’ll hear back here',
  /** better.vote_taken_back */
  voteTakenBack: 'Vote taken back.',
  /** better.shared_thanks */
  sharedThanks:
    'Thank you. It’s on the board — the makers read everything, and you’ll hear back right here.',
  /** better.share_failed — followed by the server's reason */
  shareFailed: 'That didn’t reach the board.',
  /** better.shared_inbox_failed — D4: the idea is on the board, the makers' email failed; followed by the reason */
  sharedInboxFailed: 'It’s on the board, but the email to the makers didn’t go out:',
  /** better.checking — while the mesh reads a draft (the board's LLM judge) */
  checking: 'Reading your idea…',
  /** better.forget — the author's delete control on their own Requested row */
  forget: 'Forget this idea',
  /** better.sharing — the overlay on the writer while the idea is being put on the board */
  sharing: 'Putting it on the board…',
  /** better.admin_edit — makers: reword any idea */
  adminEdit: 'Edit',
  /** better.admin_save */
  adminSave: 'Save',
  /** better.admin_cancel */
  adminCancel: 'Cancel',
  /** better.admin_delete — makers: delete any idea */
  adminDelete: 'Delete',
  /** better.admin_delete_title */
  adminDeleteTitle: 'Delete this idea?',
  /** better.admin_delete_body */
  adminDeleteBody: 'It leaves the board for everyone, with its votes. This can’t be undone.',
  /** better.admin_deleted */
  adminDeleted: 'Deleted. It’s off the board.',
  /** better.admin_saved */
  adminSaved: 'Saved.',
  /** better.forgotten */
  forgotten: 'Forgotten. It’s off the board.',
  /** better.correct_hint — on your own Requested row, kind and area cycle on tap */
  correctHint: 'Tap to correct',
  /** better.loading_failed — followed by the server's reason */
  loadFailed: 'The board didn’t load.',
  /** better.vote_failed — followed by the server's reason */
  voteFailed: 'That vote didn’t count.',
} as const
