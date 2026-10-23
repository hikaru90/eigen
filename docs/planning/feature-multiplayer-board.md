# Feature: Multiplayer board (Contribute) — persisted ideas and votes

Status: **implemented 2026-10-23** (migration `0076_board_ideas_votes`; MCP tool names follow the registry convention: `list_board` / `share_idea` / `vote_idea` / `forget_idea`, shown to clients as `eigen_*`). D2 reading: the author may remove/re-add their own +1 but not downvote their own idea (409).
Owner surface: `/feedback` (Contribute), `src/lib/feedback/*`, `/api/board/*` (replaced `POST /api/feedback`)
Risk: **critical** for the cross-tenant read path (first data in the product that
one user can see from another), **high** for the rest.

## 1. Problem

The Contribute page claims Eigenmesh is multiplayer, but the board is a client-side
fixture (`src/lib/feedback/fixture-board.ts`): ideas, votes and counts live in the
browser and reset on reload. Only sharing is real, and it only reaches the makers'
inbox (`feedback` table + email). Nobody sees anyone else's ideas or votes.

## 2. Goal

Every signed-in user sees one shared board: the same ideas, the same scores, the
same statuses. Sharing an idea puts it on that board for everyone; up/downvotes
are stored and change the score everyone sees; the makers move ideas through
Requested → In progress → Shipped.

## 3. Scope

**In scope**

- MB-1 Persisted ideas: title (verbatim user text), kind (idea / bug / polish),
  area, author, created time, status, optional makers' note, shipped time.
- MB-2 Persisted votes: one vote per user per idea, direction +1 / −1, changeable
  and removable. Unlimited — no budget.
- MB-3 Shared read: any signed-in user can list the board and see each idea's
  net score, status, note, author display, and their own vote.
- MB-4 Share: a signed-in user creates an idea; it appears on the board as
  Requested and still reaches the makers' inbox (existing email path).
- MB-5 Makers' controls (admin only, via `isUserAdmin`): change status, set/clear
  the note, mark shipped, hide an idea (moderation).
- MB-6 Author can delete their own idea while it is Requested ("Forget").
- MB-7 MCP tools so an agent can drive the board (agent-benchmark DoD).
- MB-9 Share runs one LLM judge (ontology + JSON schema, per AGENTS.md "LLM as
  judge"): it classifies kind and area, and decides whether the draft is the same
  request as an existing idea. Candidates come from embedding similarity over idea
  titles (ranking only — the LLM decides). The author can correct kind/area after.
- MB-8 Replace the fixture: page loads the real board on load, writes go to
  `+server` endpoints, then re-fetch (no `$effect`).

**Out of scope (this pass)**

- Comments/threads on ideas, notifications/email on status change, the "shipped
  since you last looked" badge from the server, realtime push (board refreshes on
  load and after your own actions only), public/anonymous access, reputation or
  vote weighting, merging two existing ideas.

## 4. Data model (proposal)

New migration `drizzle/0076_board_ideas_votes.sql` + journal entry + Drizzle schema.

`board_idea`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| author_user_id | text fk user, on delete set null | null = author deleted their account |
| title | text not null | verbatim, length-limited like `FEEDBACK_MAX_LENGTH` |
| kind | text not null | check in ('idea','bug','polish') |
| area | text not null | check in BOARD_AREAS |
| status | text not null default 'requested' | check in ('requested','in-progress','shipped') |
| planned | boolean not null default false | "picked up next" |
| maker_note | text null | |
| hidden | boolean not null default false | moderation |
| title_embedding | vector | DB-only (never returned by API/MCP/logs), for duplicate candidates |
| feedback_id | uuid fk feedback null | link to the inbox row |
| created_at / shipped_at / updated_at | timestamp | |

`board_vote`
| column | type | notes |
|---|---|---|
| idea_id | uuid fk board_idea on delete cascade | |
| user_id | text fk user on delete cascade | |
| direction | smallint not null | check in (-1, 1) |
| updated_at | timestamp | |
| pk | (idea_id, user_id) | one vote per user per idea |

Score is **computed** (`sum(direction)`) in the list query, not stored — no counter
to drift. Index `board_vote(idea_id)`.

## 5. Tenant isolation (the critical part)

Today every table is `user_id = app.current_user_id`. The board is deliberately
shared, so it needs explicit, narrow policies — not a bypass:

- `board_idea`: `SELECT` for any session with `app.current_user_id` set, rows where
  `hidden = false` (admins see hidden too via a separate admin path). `INSERT` only
  with `author_user_id = current user`. `UPDATE`/`DELETE` by author only while
  `status = 'requested'`; status/note/hidden changes only through an admin
  `SECURITY DEFINER` function that checks the role server-side.
- `board_vote`: all operations restricted to `user_id = current user`. Other users'
  votes are **never** readable row by row; the score comes from a `SECURITY DEFINER`
  aggregate function (`board_scores()`) returning `(idea_id, score)` only.
- Author display: first name plus last-name initial ("Noor K."), computed server-side
  from the account; never email or user id to other users.

## 6. API contracts

All JSON, auth required, validated with zod at the boundary, explicit errors.

- `GET /api/board` → `{ ideas: [{ id, title, kind, area, status, planned, note,
  score, myVote: -1|0|1, author: { display, isYou }, createdAt, shippedAt, own }] }`
- `POST /api/board/ideas/check` `{ title }` → `{ kind, area, duplicateOf: idea | null }`
  — the LLM judge, run when the user presses share; billed and listed in the usage
  log with markup like every other call. If `duplicateOf` is set the composer offers
  "Vote for it instead" or "Mine's different".
- `POST /api/board/ideas` `{ title, kind, area }` → 201 `{ idea, inbox: 'sent' | 'failed', inboxError? }`;
  creates the idea with the author's +1 vote and the `feedback` row, then sends the
  inbox email. An email failure does **not** undo the idea: the response says
  `inbox: 'failed'` with the reason and the page shows it.
- `PATCH /api/board/ideas/:id` (author, Requested only) `{ kind?, area? }` — correct the LLM.
- `PUT /api/board/ideas/:id/vote` `{ direction: -1 | 1 | 0 }` (0 removes) → `{ score, myVote }`.
  Shipped or own idea → 409 with the reason.
- `DELETE /api/board/ideas/:id` → author only, Requested only, else 403/409.
- `PATCH /api/board/ideas/:id` (admin) `{ status?, planned?, note?, hidden? }`.

MCP tools (MB-7): `eigen_list_board`, `eigen_share_idea`, `eigen_vote_idea`,
`eigen_forget_idea`. Budget: share → vote → list → forget in **≤ 4 calls**.
Negative probe: `direction: 2` fails with `Invalid direction: 2. Must be -1, 0 or 1`.

## 7. Failure modes

- Vote on an idea that was hidden/deleted meanwhile → 404, UI re-fetches the board.
- Double-tap races → vote is an upsert on the (idea, user) key; last write wins.
- Inbox email not configured / fails → idea is kept, response and page say the email
  didn't go out (explicit, not silent).
- LLM judge fails → retried up to exactly 3 times, then the share stops with a plain
  error ("Couldn't check your idea — try again"); nothing is created. No fallback to
  "no duplicate" or a default kind.
- DB down → endpoint 5xx with message; UI shows it in the page note, board keeps
  the last loaded state, no optimistic score left behind.

## 8. Acceptance criteria (Given / When / Then)

- AC-1 Given user A shares "Dark mode for Mesh", when user B opens Contribute, then
  B sees the idea under Requested with its starting score (0 or 1, per D2) and the
  author shown as A's display name (per D1), never A's email or user id.
- AC-2 Given B upvotes an idea at score 4, when A reloads, then A sees 5, and B sees
  their arrow filled after reload.
- AC-3 Given B upvoted, when B taps down, then the score drops by 2 and B's vote is −1.
- AC-4 Given B taps their current direction again, then the vote is removed.
- AC-5 Given any user, when they vote on 30 ideas, then all 30 are accepted (no budget).
- AC-6 Given an idea is Shipped, when anyone votes, then 409 and the score is unchanged.
- AC-7 Given B is not an admin, when B PATCHes status, then 403.
- AC-8 Given A deletes their own Requested idea, then it disappears for everyone and
  its votes are gone; given it is In progress, then 409.
- AC-9 Given user C, when C queries `board_vote` directly under RLS, then C sees only
  C's own rows (no one else's votes or identities).
- AC-10 Given an admin hides an idea, then non-admins no longer see it.
- AC-12 Given an idea "Dark mode for Mesh" exists, when B shares "Mesh needs a dark
  theme", then the judge returns it as `duplicateOf` and B is offered to vote instead;
  given B picks "Mine's different", then a separate idea is created.
- AC-13 Given B shares "Voice capture cuts off", then kind and area come from the
  judge (e.g. bug / capture) and B can change them while it is Requested.
- AC-14 Given a share, then the board shows score 1 with B's upvote already set.
- AC-15 Given the inbox email fails, then the idea exists and the page says the email
  didn't reach the makers.
- AC-16 Given the LLM judge fails 3 times, then nothing is created and the error says so.
- AC-11 Given an agent with an API key, when it runs share → vote → list → forget via
  MCP, then each step reflects the DB and cleanup leaves no idea behind.

## 9. Test plan

- Unit: judge prompt contract + JSON schema validation (and rejection of malformed
  output), retry-exactly-3, display-name formatting ("Noor K."), embedding stripped
  from every response.
- Regression (LLM judge): negative cases that must **not** be duplicates (same area,
  different request) alongside positive paraphrases.
- Unit: vote transitions (`votes.ts`, already written for the client), zod body
  schemas, score aggregation mapping, author-display redaction.
- Integration (DB, RLS on): AC-2…AC-10 against two real tenant sessions —
  especially AC-9 and the hidden-row case. Migration applies cleanly.
- E2E (headed release suite): two browser contexts, A shares, B votes, A reloads
  and sees the score; downvote flip; shipped is not votable.
- MCP agent benchmark: AC-11 with the negative probe.

Coverage tier: `board` server modules + RLS policies **critical (95%)**; UI high.

## 10. Rollout

1. Migration + schema + policies. 2. Endpoints + tests. 3. Page switches from the
fixture to `GET /api/board` (fixture file deleted, not kept as fallback). 4. MCP
tools. 5. Seed: none in production; the demo rows go away.

## 11. Decisions (operator, 2026-10-23)

- **D1 Author display:** first name + last-name initial ("Noor K.").
- **D2 Self-vote:** sharing counts as the author's +1; they can remove it.
- **D3 Duplicates:** LLM judge in this pass (MB-9), one call per share, shown in the
  usage log.
- **D4 Inbox email failure:** keep the idea, report the failure explicitly.
- **D5 Kind/area:** the LLM judge picks on share; the author can correct.
- **D6 Makers:** existing admins (`isUserAdmin`).
