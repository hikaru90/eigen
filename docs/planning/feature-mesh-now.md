# Feature: Now, the card at the top of Yarn that tells you what to do

Status: **approved 2026-11-09, in implementation** (operator approved the defaults in §3 and the
mockup; "Build it").
Risk: **high**. New LLM call, new per-user table, one-tap writes to thought lifecycle and project
membership. It does not change ingestion: a next step typed on a card goes through the normal
`captureThought` path.

## 1. Problem

Eigen captures well and rarely tells the user what to do. Measured against Getting Things Done
(2026-11-09, from the code and the operator's live projects):

- **Nothing answers "what now?"** Mesh opens on Yarn (newest first); Threads sorts by last added.
  `/desk` is in neither the bottom nav nor the menu.
- **Nobody sorts the pile.** `open_threads` listed 35 loose open items, oldest from 5 June. Some
  name a project in their own words. Some are not actions at all: finished-work reports, records,
  a duplicate. Nothing ever asks the user about them.
- **Projects with nothing left look healthy.** 7 of 10 active projects have no open task and no
  next action, and `computeStalledSignal` returns `null` for them because it requires
  `openTaskCount > 0`. GTD treats a project without a next action as the main failure.
- **Next actions are pointers, not decisions.** `nextActionThoughtId` is stored and moves to the
  next open item by rank (`project-next-action.ts`). Nothing checks that it is concrete or that it
  matters today.
- **Reflection prompts feel right but add to the pile.** They read the user's situation and speak
  about one concrete thing, which is the feeling the operator wants more of. But they only ask,
  and answering creates a new thought. Nothing gets closed.

**Note on the 35.** `loadOpenThreads` counts a thought as loose when it is in no
`project_task_sequence`, and it includes goals. A project's `openTaskCount` counts
`thought_entity` membership and tasks only. So a task linked to a project but never ordered counts
in both places, and "35 outside any project" is an upper bound. `assignThoughtToProject` writes
membership without a sequence row, so it can create this overlap. The digest's "needs a thread"
count inherits it. See NOW-4 and NOW-12.

## 2. Goal

Opening Mesh shows one card at the top of Yarn, above the list of captured thoughts: one thing to
do or decide, written from the user's own situation, answerable in one tap. Answering brings the
next card at once. Every answer leaves less to deal with.

Page roles after this feature: **Capture adds, Mesh clears, Ask talks it through.**

## 3. Decisions

The defaults below were approved on 2026-11-09. The spec assumes them.

| # | Decision | Default | Alternative |
|---|---|---|---|
| D1 | Where it lives | **Decided by the operator (2026-11-09):** inside Yarn, above the list. No tab of its own. The tabs stay Yarn, Threads, Patterns, and Mesh still opens on Yarn. | n/a |
| D2 | How directive | One card, no visible list. Worded as an instruction ("Call the landlord about the deposit"). "Not now" is always available and needs no reason. | Show the top 3 and let the user choose (brings the deciding back) |
| D3 | What ranks the cards | LLM decides from deadlines, overdue dates, age, how often a card was skipped, project order, local time and weekday. | Fixed formula (forbidden for meaning by "LLM as judge") |
| D4 | Do versus chores | Card 1 of a deck is an action whenever a concrete one exists. Then sorting and action cards mix, at most two chores in a row. | Clear the whole pile first (35 chores before the first instruction) |
| D5 | Cost limit | One deck is up to 12 cards from one LLM call, at most 3 decks per local day, shown in the usage log like every call. | No limit, or one deck a day |

## 4. Scope

### In scope

**Cards**

- **NOW-1 Four kinds.** All cards have an instruction (`text`) and one reason line (`why`).

  | Kind | Example | Answers |
  |---|---|---|
  | `do` | "Send the signed form to the accountant." / "Your deadline is in 9 days." | Done · Not now · Too big |
  | `sort` | "Change the key battery: still open?" / "From September, no date since." | Done · Drop · Keep |
  | `file` | "This sounds like Empathy Link. Move it there?" | Yes · Other project · Not a task |
  | `unblock` | "Sewer has no next step. How about: book the site visit?" | Yes · Something else · Someday · Finished |

- **NOW-2 What each answer does.** All writes reuse existing functions.

  | Answer | Effect | Function |
  |---|---|---|
  | Done | Thought completed; a next-action pointer on it moves on | `setThoughtLifecycleStatus('completed')` |
  | Drop | Thought archived (soft, nothing deleted) | `setThoughtLifecycleStatus('archived')` |
  | Keep | Target hidden from cards for 30 days | `now_card.hidden_until` |
  | Not now | Target hidden until the next local day; skip count +1 | `now_card.hidden_until` |
  | Too big | Opens Ask (NOW-9); target hidden until the next local day | `now_card.hidden_until` |
  | Yes (`file`) / Other project | Thought joins the project and goes last in its order. If the project has no next action, it becomes the next action | `linkThoughtToProject`, `orderTaskInProject`, `designateNextAction` |
  | Not a task | Category set to the card's `notTaskCategory`. The thought stays in memory and stops counting as open work | new, single-purpose write (NOW-5) |
  | Yes (`unblock`) | The suggestion is captured, joins the project and becomes its next action | `captureThought` (source `now`), then as `file` |
  | Something else | Same, with the user's typed or spoken text, using the existing writer | same |
  | Someday / Finished | Project status changes | same write as `edit_project` |

- **NOW-3 Undo.** After Done, Drop, Yes/Other project or Not a task, an Undo control stays for 6
  seconds and restores the prior state, including the next-action pointer. Today's reopen restores
  only the graph anchor node (`applyThoughtGraphForLifecycleStatus`), so Undo must also rebuild the
  mention edges from `thought_entity`. Undo applies to the latest answer only. It does not cover
  captured `unblock` text (delete the thought normally).

**Picking the cards**

- **NOW-4 Candidates (no meaning decided here).** Structural query only:
  - open `task` and `goal` thoughts, by any author, marked with their author, membership,
    project rank, linked event date, age and skip count;
  - active projects with label, deadline, milestones, next action and open-task count;
  - excluding targets with `hidden_until` in the future.

  "Loose" means no project **membership**, not "no sequence row" (§1). Limit 150 candidates, oldest
  first dropped; `candidatesOmitted` is returned so the cut is visible, never silent.

- **NOW-5 One LLM call writes a deck.** Through `llmChatCompletion` with `logContext:
  'mesh_now_deck'`, in the user's language. The chat judge, not Jev, because the output is
  free text (`09-jev-decision-plane.md` §2). Output:

  ```json
  {
    "cards": [
      {
        "kind": "do | sort | file | unblock",
        "thoughtId": "uuid, required for do/sort/file",
        "projectEntityId": "uuid, required for file/unblock",
        "text": "≤ 140 characters",
        "why": "≤ 100 characters",
        "suggestedStep": "≤ 140 characters, required for unblock",
        "notTaskCategory": "ontology key, required for file"
      }
    ]
  }
  ```

  Prompt rules, in the voice of reflection prompts:
  - Imperative and concrete; name the real thing; use only facts listed; never invent dates or
    people.
  - `do` only for something physically doable as written. A vague next action gets `unblock`, not
    `do`, and may ignore the stored pointer and its rank.
  - A finished-work report, a record or a duplicate gets `sort`, not `do`.
  - Something skipped several times gets `sort`, not `do` again.
  - Follow D3 and D4.

  Post-LLM code only validates: schema, lengths, ids present in the candidate set, the fields each
  kind requires, `notTaskCategory` in the user's ontology, one card per target. It never re-ranks,
  re-types or filters by meaning.

- **NOW-6 Failure.** Any validation failure fails the whole attempt. Exactly 3 attempts, then HTTP
  502 with a plain message and a Try again button. Insufficient credits gives 402 with the billing
  message. No canned cards, no "top of the list" substitute, no silently dropped card.

- **NOW-7 When a deck is written.** On a request with no valid pending card, and only if candidates
  exist and fewer than 3 decks exist for this local day. Pending cards expire at the local day
  change. Before serving, a card whose target is no longer open (or whose `unblock` project now has
  a next action) is marked `superseded` and skipped; this is a state check, no LLM. A thought
  captured mid-day waits for the next deck.

**Storage**

- **NOW-8 Table `now_card`** (RLS: owner only).

  `id, user_id, local_day, deck_number, position, kind, target_thought_id, target_project_entity_id,
  payload_encrypted, status (pending | answered | superseded | expired), answer, undo_state_encrypted,
  hidden_until, answered_at, created_at`

  - Unique `(user_id, local_day, deck_number, position)`: first writer wins when two tabs generate.
  - `payload_encrypted` (text, why, suggestion) uses the tenant envelope, like reflection prompts.
  - Skip count comes from these rows.
  - Migration `drizzle/0086_now_card.sql` plus its journal entry in the same change.
  - `captureSourceEnum` gains `now`.

**Ask**

- **NOW-9 Too big opens Ask.** `/chat?breakdown=<cardId>`: the page's server load checks the card
  belongs to the user and returns its task text; on mount the page starts a new conversation and
  sends an ordinary message asking to break that task down. This is a new, small entry point: the
  existing `bootstrap` send is specific to `?mode=briefing`, so it is a model for the on-mount send,
  not something to reuse. Ask follows its existing rule: `propose_thoughts`, confirm, store. Stored
  steps become candidates for the next deck.

- **NOW-10 One picker.** `get_now_cards` (NOW-13) is exposed in chat, and Ask's prompt tells it to
  answer "what should I do?" from those cards. The user's situation ("20 minutes, tired") chooses
  among them. Ask cannot answer cards in this version.

**UI**

- **NOW-11 Now card on `/mesh/yarn`.**
  - A component at the top of the Yarn page, above History and the list. There is no `/mesh/now`
    page or tab. Tabs, `/mesh` redirect and `BOTTOM_NAV_HREFS.mesh` are unchanged.
  - Look, set by the operator on the mockup (2026-11-09): the card has no background fill and no
    shadow. Text uses the theme's ink tokens. Lime `#D2FF03` from the operator's reference image is the
    only accent: a thin lime border in the dark theme (thin ink border in the light theme, where lime
    would not show), rounded corners, white space around it. A small label "Lightning questions" /
    "Blitzfragen" sits at the top inside it, led by a minimal thin-stroke black lightning bolt on a
    small lime circle (decorative, hidden from screen readers). The instruction is large, in the
    user's voice font (`font-you`). The answers are underlined text links with no background at all;
    the first one is simply stronger ink. History sits close under the card with the card's horizontal
    padding, so its text lines up with the card's content, and clear space separates it from the
    "Captured thoughts" label. The rest of the app keeps its palette.
  - It fetches once on mount, so Yarn's load and instant tab switching are not slowed down by the
    LLM. Each answer posts and renders the card in the response. No `$effect`.
  - While a deck is written the card says so in one line; the list below is usable meanwhile.
  - States: card, error (502 with Try again), credits (402), clear ("Nothing needs you right now"),
    limit ("That's it for today", D5). Clear and limit shrink to one quiet line, so the list moves up.
  - While a Mesh search is active, Now and History are hidden so the results sit directly under the
    tabs. Closing the search brings them back with their state intact.
  - Offline: Yarn is stored as a core page but the card comes from the API, so it shows the offline
    line and no actions, and the stored list stays readable.
  - Strings in en and de. Components from `src/lib/components/ui/` first (Other project picker).

- **NOW-15 The list says what it is.** A small label directly above the strand and close to it,
  "Captured thoughts" / "Erfasste Gedanken", in the same small sans style as "Quick questions". It
  shows above the empty state too. It separates the things asking for a decision (Now, History) from
  the record of what was captured.

**History**

- **NOW-14 History card on Yarn.** The Now card stays one card with nothing to look back at.
  - A collapsed History toggle sits directly below the Now card, above the list label (NOW-15), with
    a count of answered cards. It is small grey text ("History 3" and a chevron), never the most
    prominent thing on the page.
  - Tapping it opens the list directly below it, newest first, grouped by local day. Each row shows
    the card's text, the answer in words ("Marked done", "Moved to Hydra") and the time. Rows with a
    thought link to `/thought/[id]`.
  - Read-only, for reference: no answering, no Undo, no re-opening from here.
  - It lists `now_card` rows with status `answered`. An undone answer goes back to `pending` and
    leaves the history. `superseded` and `expired` cards were never answered and are not listed.
  - The list is fetched on the tap that first opens the card (no `$effect`), 50 rows at a time, and
    makes no LLM call. Only the count is part of the Yarn page load.
  - The card is hidden while there is no history. Mesh search does not filter it (NOW-11).

**Honest signals**

- **NOW-12 Stalled rule and loose count.**
  - `computeStalledSignal` returns `no_next_action` for any active project with no next action,
    whatever its open-task count. Digest, Threads and reflection prompts then show the real count.
  - `loadOpenThreads` treats a task with project membership as not loose, whether or not it has a
    sequence row, so the digest's count matches the cards.

**Agents**

- **NOW-13 MCP tools.** `get_now_cards` returns pending cards, writing a deck if NOW-7 allows; also
  exposed in chat. `answer_now_card { card_id, answer, project_entity_id?, text? }` applies NOW-2;
  `exposeInChat: false`. Budget in §7.

### Out of scope, in planned order

1. Morning push names the first action and links to its card (`dailyDigestPush`; the dispatch
   writes the deck first).
2. Task-level waiting-for and someday. Until then Keep and Not now carry these items.
3. Weekly review as a deck of the same cards.
4. Agent work reports no longer stored as open tasks. Until then they surface as `sort` cards.
5. Ask answering cards through the propose/confirm guard.

Also not here: creating a project from a card (`file` only targets existing projects, so the GTD
judge rule is untouched), energy or context filters (tasks have no such data), a card refresh
button, changing reflection prompts or Lena's board request, removing `/desk`.

## 5. API contract

**`GET /api/mesh/now`**: 200 with one of

```json
{ "state": "card", "card": { "id": "…", "kind": "do", "text": "…", "why": "…", "project": { "id": "…", "label": "…" } }, "remaining": 7, "candidatesOmitted": 0 }
{ "state": "clear" }
{ "state": "limit" }
```

401 unauthenticated, 402 credits, 502 after 3 failed attempts (`{ "error": "<plain message>" }`).

**`POST /api/mesh/now/cards/[id]/answer`**: body `{ "answer": "done", "projectEntityId"?: "…", "text"?: "…" }`.
200 is the same shape as GET plus `undo: { "cardId": "…" } | null`. If the write succeeds and the
next deck fails, the response is 200 with `state: "error"` and the message: the answer stands and
the page shows Try again.

- 400: answer not valid for this kind, or a required field missing, with the constraint named.
- 404: not this user's card.
- 409: card already answered (double tap); nothing is written.

**`POST /api/mesh/now/cards/[id]/undo`**: 200 returns that card again. 409 after the 6-second window
or if it is no longer the latest answer.

**`GET /api/mesh/now/history?before=<cursor>`**: 200 with

```json
{ "items": [{ "cardId": "…", "kind": "do", "text": "…", "answer": "done", "answerLabel": "Marked done", "answeredAt": "…", "thoughtId": "…" }], "nextCursor": null }
```

401 unauthenticated. No LLM call.

## 6. Acceptance criteria

- **NOW-AC1** Given open tasks and no deck today, when the user opens Mesh, then Yarn loads with its
  list usable, one LLM call writes a deck, it is stored encrypted, and one card shows above the list.
- **NOW-AC2** Given a pending deck, when Mesh opens again, then the same card shows with no LLM call.
- **NOW-AC3** Given a `do` card, when the user taps Done, then the thought is completed, any
  next-action pointer moves on, and the next card shows with no LLM call.
- **NOW-AC4** Given a `do` card, when the user taps Not now, then the thought stays open and is not
  a candidate again until the next local day.
- **NOW-AC5** Given a `do` card, when the user taps Too big, then a new Ask conversation opens with
  the task sent, and nothing is stored until the user confirms a proposal.
- **NOW-AC6** Given a `sort` card, when the user taps Drop, then the thought is archived; when they
  tap Keep, then it stays open and is hidden for 30 days.
- **NOW-AC7** Given a `file` card, when the user taps Yes, then the thought is a member of that
  project, last in its order, no longer counted as loose, and no project was created.
- **NOW-AC8** Given a `file` card, when the user taps Not a task, then the category is
  `notTaskCategory`, the thought is still open and retrievable, and it is no longer a candidate.
- **NOW-AC9** Given an `unblock` card, when the user taps Yes, then a thought with the suggestion
  exists (source `now`) and is the project's next action; when they tap Someday, then the project's
  status is `someday` and no thought was created.
- **NOW-AC10** Given an answer within 6 seconds, when the user taps Undo, then status, category,
  membership, order, next-action pointer and mention edges match their prior state and the card
  shows again.
- **NOW-AC11** Given the LLM returns an id outside the candidates, a `file` card without
  `projectEntityId`, or invalid JSON, three times, when Now loads, then the response is 502 with a
  plain message, nothing is stored, and Try again is shown.
- **NOW-AC12** Given no candidates, when Now loads, then the state is `clear` and no LLM call is made.
- **NOW-AC13** Given 3 decks today and none pending, when Now loads, then the state is `limit` and no
  LLM call is made.
- **NOW-AC14** Given a pending card whose thought was completed elsewhere, when it would be served,
  then it is marked `superseded` and the next one shows.
- **NOW-AC15** Given a card and a double tap, when the second answer arrives, then it gets 409 and
  only one write happened.
- **NOW-AC16** Given another user's card id, when any endpoint is called, then the answer is 404 and
  nothing is written or revealed.
- **NOW-AC17** Given an active project with no open task and no next action, when stalled signals
  are computed, then the reason is `no_next_action`; given a `someday` project, then it is `null`.
- **NOW-AC18** Given a task with membership and no sequence row, when open threads load, then it is
  not listed as loose.
- **NOW-AC19** Given the user is offline, when Yarn opens, then the card area shows the offline line,
  no answer can be sent, and the stored list is readable.
- **NOW-AC20** (regression, negative) Given an ingredient, a relative or a single task mentioned
  often, when a deck is written and answered, then no card or answer creates or promotes a project.
- **NOW-AC21** Given a user asks Ask what to do, when it answers, then it called `get_now_cards` and
  its answer is one of those cards.

- **NOW-AC22** Given answered cards, when the user opens Yarn, then a collapsed History card with the
  count sits below the Now card, and tapping it shows the answered cards below it, newest first, with
  no LLM call and no answer controls.
- **NOW-AC23** Given an answer that was undone, when History opens, then that card is not listed;
  given no answered cards, then the History card is not shown.
- **NOW-AC24** Given any state, when Yarn opens, then the tabs are Yarn, Threads, Patterns and the
  "Captured thoughts" label sits directly above the list or its empty state.
- **NOW-AC25** Given a Now card, when the user searches in Mesh, then Now and History are hidden and
  the results sit under the tabs; when the search closes, the same card shows with no LLM call.

## 7. Tests and agent benchmark

Written before the code (TDD), with the LLM stubbed. Do not run Q&A evals.

**Unit**
- `src/lib/server/mesh/now-candidates.spec.ts`: the structural query, hidden targets, omitted count,
  loose by membership.
- `src/lib/server/mesh/now-deck.spec.ts`: messages, schema, every validation failure, 3 attempts,
  402 passthrough, cost limit, day change, first-writer-wins.
- `src/lib/server/mesh/now-answer.spec.ts`: every row of NOW-2, Undo round trips, wrong answer for a
  kind, 409, cross-user 404.
- `src/lib/server/mesh/now-history.spec.ts`: only answered rows, order, cursor, undone rows gone,
  cross-user isolation.
- `src/routes/api/mesh/now/**/server.spec.ts`: auth and status codes.
- Updated: `project-list` and `open-threads` (stalled and loose rules), `daily-digest`.

**Critical-path regression**: reopen restoring mention edges (`lifecycle.spec.ts`), negative GTD
cases (NOW-AC20).

**Browser component**: `now-card.svelte.spec.ts`, answers per kind, Undo timer, each page state.

**E2E (headed, `test:e2e:release:headed`)**: `src/routes/e2e/mesh-now.e2e.ts`: the card shows above
the heading and list, Done brings the next card, Not now, Undo, Too big reaches Ask, 502 shows Try
again while the list stays usable, search hides and restores the card, offline line.

**Agent benchmark**: budget **2 calls** for the happy path: `get_now_cards`, `answer_now_card`.
- Cleanup: `delete_thought` on anything an `unblock` test-drive captured, `edit_project` to restore a
  status, verified by `get_now_cards` and `list_projects`.
- Negative probes, each failing with the constraint: unknown `answer`; `answer: "too_big"` on a
  `file` card; `project_entity_id` missing on Other project; non-uuid `card_id`; an unknown argument.
- `answer_now_card` not offered in Ask is asserted.
- Add a "Now" section to `docs/testing/agent-benchmark.md`. Automated in
  `src/lib/server/mcp/now-test-drive.spec.ts`.

## 8. Failure modes and risks

| Risk | Handling |
|---|---|
| The picker gives weak orders because the pile is noisy | Sort and file cards are the cure, and D4 keeps them from crowding out actions. Judge by use after a week. |
| Too many chores make it feel like admin | D4 limit; Keep hides for 30 days; a real `do` leads every deck |
| A wrong one-tap write | All writes are soft and Undo exists (NOW-3). Nothing is deleted. |
| Stalled count jumps (7 more projects today) | Intended. The digest wording says the real number; `unblock` cards are what brings it down. |
| LLM cost | D5 limit; every call in the usage log with cost and markup |
| Personal text in logs | Payload encrypted; logs carry ids and error text only, through the redaction pass |
| Enrichment classes a captured `unblock` step as non-task | `designateNextAction` still points at it. Tested; if it hides from open-task lists, fix the classification, not the card. |
| A new urgent thought waits for the next deck | Accepted for this version (NOW-7). Revisit with the morning push. |

## 9. Implementation order

Each step lands with its tests, on main.

1. NOW-12 stalled and loose rules (useful alone, also corrects the digest).
2. Migration, candidates, deck writer, `GET`.
3. Answers and Undo, including the reopen fix, `POST`.
4. Now card on Yarn, the "Captured thoughts" heading, en/de strings.
5. History card on Yarn and its endpoint.
6. Too big into Ask.
7. MCP tools, the Ask picker rule, agent benchmark section.
8. `docs/repo-map` update: Mesh owns Now, Capture owns reflection prompts.
