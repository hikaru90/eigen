# Relevance check-in policy

**Status:** Implemented (template selection + Keep / Not anymore).

Optional Capture cards and push nudges may ask whether an aged thought is still relevant. This is the same **check-in channel** as grounding questions (shared cadence), but answers change **thought lifecycle / salience**, not `user_grounding_profile` facets.

Related: [`grounding-question-policy.md`](./grounding-question-policy.md).

---

## Purpose

As a corpus grows, automatic salience decay fades unused memories. Relevance check-ins let Eigen **confirm with the user** when something looks stale but the system is unsure — so unimportant notes leave broad retrieval and the graph, while still-relevant ones get a soft reconsolidation bump.

---

## Non-negotiable rules

### 1. Same channel, different write path

| Kind        | Delivery                       | Answer effect                                      |
| ----------- | ------------------------------ | -------------------------------------------------- |
| `grounding` | Capture card + optional push   | Facet on `user_grounding_profile`                  |
| `relevance` | Same card slot + optional push | Keep → access/salience bump; Not anymore → archive |

One prompt slot under the shared cadence (every 10 captures, ≥7 days since last check-in). Prefer grounding when a concrete enrichment blank exists; otherwise relevance.

### 2. Never ask just to ask

Gates (all must pass):

| Gate           | Question                                                                              |
| -------------- | ------------------------------------------------------------------------------------- |
| **Candidate**  | Is there an open, non-task thought inactive long enough with structural fade signals? |
| **Utility**    | Would Keep or Archive change ranking / retrieval / graph visibility?                  |
| **Askability** | Can the user decide with one tap (still relevant / not anymore)?                      |

If the LLM skips or no candidates → silence.

### 3. Everyday voice, approved templates only

Wording comes from [`relevance-templates.ts`](../../src/lib/server/grounding/relevance-templates.ts). The LLM only picks `templateId` + `thoughtId` from a shortlist — never free-form question text.

### 4. Prefer thoughts over open todos

Open `category = 'task'` thoughts are excluded from the candidate pool (timeline + heartbeat already boost tasks). Durable `fact` / `decision` / `preference` and `metadata.neverStale` thoughts are also excluded.

### 5. Soft demotion, not hard delete

“Not anymore” archives the thought (`lifecycle_status = archived`): out of broad retrieval and removed from the AGE graph. Rows remain recoverable via future restore/admin paths.

---

## Implementation

1. Due gate: `isCheckInQuestionDue` (alias of grounding due).
2. Generator: `generateCheckInQuestion` → grounding first, then `generateRelevanceQuestion`.
3. Candidates: `loadRelevanceCheckInCandidates` (structural only).
4. Answer: `applyRelevanceCheckInAnswer` → keep / archive.
5. UI: [`grounding-question-card.svelte`](../../src/lib/components/grounding-question-card.svelte) relevance branch; push deep-link `/capture?checkin=1`.

---

## Review checklist

- [ ] Answer writes lifecycle/salience, not grounding facets
- [ ] Template wording is everyday; no free-form LLM question text
- [ ] Open tasks and never-stale memory types are excluded from candidates
- [ ] Shared check-in cadence still one card at a time
- [ ] Archive path removes the thought from retrieval and the graph
