# Feature: Ask proposes thoughts, stores them on "yes"

Status: **approved by the operator 2026-10-27.** Risk: **critical** (ingestion path).
Contribute board item: "Ask route should be able to extract meaning and capture thoughts" (24cf8b7b).
Supersedes the Ask part of `public-benchmarks.md` §4b P1 (silent capture from Ask).

## 1. Problem

Ask is a chat wrapper around the MCP tools — questions, projects, tidying up, deleting — but it is
deliberately ask-only: `capture_thought` is excluded from `CHAT_AGENT_TOOL_NAMES`
(`src/lib/server/mcp/registry.ts`), rejected by `REMOVED_TOOL_HINTS` and forbidden by the system
prompt (`src/lib/server/llm/agent-loop.ts`). When the user rambles into Ask (typed or by voice),
what they say about themselves is lost.

## 2. Two mechanisms, two use cases

- **Capture** stays as it is: stores what you write, verbatim, immediately (with the existing
  interpret → confirm flow).
- **Ask** extracts thoughts it judges worth keeping and **proposes** them in the chat. Nothing is
  stored until the user says yes.

## 3. Behaviour

- AP-1 **Jev checks every Ask message.** For each user message, one Decisions call (surface
  `chat_turn`, new kind `capture_worthy`: `yes | no` — "does this message contain something about the
  user or their life worth keeping in their mesh?") runs alongside the existing turn. Enforced:
  a failure shows a short, visible note in the reply ("couldn't check this message for thoughts"),
  never a silent skip; the rest of the turn still answers.
- AP-2 **Proposal in plain chat.** When `capture_worthy = yes`, the agent handles the request as
  usual (answers the question, runs the tool) and then calls the Ask-only tool
  `propose_thoughts({ thoughts: string[] })` with one or more self-contained thoughts in the user's
  voice. Its reply lists them in ordinary text: "I'd store these in your mesh: … — say yes, or tell me
  what to change." No special UI. The proposal lives in that tool call's persisted result
  (`chat_message` already stores tool_call / tool_result metadata) — no new table.
- AP-3 **Reply judged by Jev.** When the previous assistant turn holds an open proposal, the next user
  message also gets a Decisions call (kind `proposal_reply`: `confirm | revise | unrelated`).
  - `confirm` → the agent calls `store_thoughts({ proposal_id })`, which stores every thought of that
    proposal exactly as proposed. The tool call is visible in the chat, so the user sees what happened.
  - `revise` → the agent applies the requested change and calls `propose_thoughts` again; the new
    proposal replaces the old one; the user confirms again.
  - `unrelated` → nothing is stored; the proposal is closed. Ignoring a proposal stores nothing.
- AP-4 **Server guard.** `store_thoughts` accepts only the latest open proposal of this chat session,
  only in the user turn directly after it, and only when `proposal_reply = confirm` for that turn.
  It takes the thoughts from the persisted proposal (the model never re-sends the text), so the stored
  text is exactly what was proposed. Anything else is rejected with a clear tool error.
- AP-5 **Storing.** Each thought goes through `captureThought` (source `ask`), `raw_text` = the
  proposed text the user approved, linked to the chat session for provenance, then the normal
  enrichment (embedding, entities, project detection). No interpret/confirm modal — the chat
  confirmation is the confirmation.
- AP-6 **Name stays "Ask".** Prompt rewrite: the "ask-only, never store" rule is replaced by the
  propose → confirm rule; `capture_thought` stays unavailable in Ask (only the two new tools).

**Out of scope:** a confirmation UI widget, auto-accept timers, storing anything without a confirm,
a facts layer (the parked user-facts work on `benchmark-work` stays parked), MCP clients outside Ask
(they keep `capture_thought` unchanged).

## 4. Acceptance criteria (Given / When / Then)

- AC-1 Given "I started bouldering on Tuesdays with Jonas, what should I plan for the weekend?",
  when `capture_worthy = yes`, then the reply answers the question and proposes the bouldering
  thought(s) in plain text; no thought is stored.
- AC-2 Given an open proposal, when the user replies "yes", then `store_thoughts` stores exactly the
  proposed texts as thoughts (source `ask`) and the tool call shows in the chat.
- AC-3 Given an open proposal, when the user replies "the second one is wrong, it's Wednesdays",
  then a revised proposal is shown and nothing is stored until a later confirm.
- AC-4 Given an open proposal, when the user asks something unrelated, then nothing is stored and
  a later "yes" cannot store the old proposal.
- AC-5 Given a pure question ("what's on my list for next week?"), when `capture_worthy = no`, then no
  proposal appears.
- AC-6 Given the model calls `store_thoughts` without a confirmed open proposal, then the server
  rejects it and nothing is stored.
- AC-7 Given the `capture_worthy` decision fails, then the reply carries the visible note and still
  answers.
- AC-8 Given a stored Ask thought, then it is enriched like any capture and appears in Yarn.

## 5. Test plan (tests first)

- Unit, fake LLM/Decisions: AP-1 decision wiring per message; propose tool persists the proposal;
  guard cases of AP-4 (no proposal, stale proposal, not the next turn, reply not `confirm`,
  superseded proposal); store uses persisted text; `capture_thought` still rejected in Ask; prompt
  rule present. Regression: questions never produce stored thoughts without a confirm.
- Integration: Ask turn → propose → "yes" → thoughts rows with source `ask` + enrichment scheduled.
- E2E (headed, `src/routes/e2e/`): Ask → proposal text visible → "yes" → store tool call visible →
  thought in Yarn.
- Coverage tier: critical (95%) for the guard and store path.
- Agent benchmark: drivable via MCP within budget incl. one negative probe (store without confirm).

## 6. Decisions (operator, 2026-10-27)

- No special confirmation UI: plain chat text, the user types changes or says yes.
- Stored text = the proposed text.
- Jev checks every Ask message; ignoring a proposal stores nothing.
- The name stays Ask.

## 7. Implementation notes (2026-10-27)

Code: `src/lib/server/chat/ask-proposals.ts` (proposal read-back + AP-4 rule), `ask-turn-decisions.ts`
(the one Jev call per turn + turn plan), `src/lib/server/mcp/ask-proposal-tools.ts` (the two tools +
guard), `agent-loop.ts` (decisions, required-tool loop), `run-ask-turn.ts` / `handle-agent-chat-post.ts`
(session wiring, appendix). Decision kinds `capture_worthy` / `proposal_reply` are registered in
`decision-client.ts` and asked on every Ask turn (not gated by `DECISION_ENFORCE_KINDS`).

Choices the spec left open:

- The reply is the model's answer plus a **server-written block** (lead-in, numbered thoughts, footer)
  built from the persisted proposal, so what the user reads is exactly what `store_thoughts` stores.
  `answer_question` no longer ends a turn that still owes `propose_thoughts` / `store_thoughts`; the
  model is re-asked at most twice, then the reply carries a visible note ("nothing was proposed/stored").
- `propose_thoughts` is allowed only when `capture_worthy = yes` or the reply is `revise`, never on a
  `confirm` turn (server-enforced). Proposals are bounded (6 thoughts, 500 characters each) so the
  persisted tool result always parses back.
- A proposal is closed by the next user message (strict "directly after"): a failed turn or "Send again"
  between proposal and reply also closes it; the user just asks again.
- Source `ask` is a TS-only addition (`thought.capture_source` is a plain text column, no migration).
  Provenance (`askSessionId`, `askProposalId`) lives in the encrypted thought metadata.
- Both tools are in-app Ask only (`exposeInMcp: false`); HTTP MCP clients keep `capture_thought`.
