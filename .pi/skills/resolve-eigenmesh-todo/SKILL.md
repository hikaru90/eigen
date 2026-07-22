---
name: resolve-eigenmesh-todo
description: 'When given a to-do or thought text, retrieve it from EigenMesh, implement the task, and mark it complete. Handles the full lifecycle: find, implement, verify, mark done.'
---

# Resolve EigenMesh To-Do

## The Rule

When the user gives you a to-do, thought, or task (either as text or by referencing one), you MUST:

1. **Retrieve the thought** from EigenMesh using `eigen_retrieve_thoughts`
2. **Get the thought ID** from the search results
3. **Understand the task** — read the thought carefully, check linked thoughts and attached files if needed
4. **Implement the fix/feature** — make the necessary code changes
5. **Verify it works** — run relevant tests, type checks, or manual verification
6. **Mark it complete** — use `eigen_edit_thought` with `edit_request: "mark complete"`
7. **Capture what was done** — use `eigen_capture_thought` to document the implementation

## Step-by-Step Workflow

### Step 1: Retrieve the Thought

```javascript
eigen_retrieve_thoughts(
  query: "<exact or paraphrased text of the to-do>",
  top_k: 1
)
```

If the search doesn't find it, try variations:

- Use key phrases from the thought
- Try without filler words ("todo for eigenmesh:" etc.)
- Search with `include_agent: true` if it might be an agent thought

### Step 2: Extract the Thought ID

From the search results, get the `id` field:

```json
{
  "id": "98e237a1-1fa0-4d8a-bd62-8b4072819896",
  "snippet": "Ensure project entities are visible on timeline tab...",
  ...
}
```

### Step 3: Understand the Task

Before implementing, gather context:

- Read the full thought if needed (check `textFiles` for attached details)
- Read linked thoughts (`linkedThoughts` in results) for related context
- Understand what "done" looks like for this task

### Step 4: Implement

Follow the project's guardrails:

- Read files before editing
- Make targeted changes
- Run tests to verify
- Follow commit conventions

### Step 5: Verify

Run appropriate checks:

```bash
npm run check          # Type checking
npm run test:unit:run  # Unit tests
```

### Step 6: Mark Complete

```javascript
eigen_edit_thought(
  thought_id: "<thought-id>",
  edit_request: "mark complete"
)
```

### Step 7: Document

```javascript
eigen_capture_thought(
  raw: "Completed: <brief description of what was done>. <One sentence explaining the approach>.",
  as_user: true
)
```

## Example

**User says:** "is this done? 1. 2026-07-07 16:35 · observation — Ensure project entities are visible on timeline tab in Eigenmesh"

**Agent workflow:**

1. Search: `eigen_retrieve_thoughts(query: "project entities visible timeline tab Eigenmesh", top_k: 1)`
2. Found: `id: "98e237a1-1fa0-4d8a-bd62-8b4072819896"`
3. Check related agent thoughts — found fixes for "Timeline projects view missing tasks"
4. Verify implementation exists in codebase
5. Mark complete: `eigen_edit_thought(thought_id: "98e237a1-...", edit_request: "mark complete")`

## Handling Different Task Types

### Bug Fixes

- Understand the root cause from the thought text
- Find the relevant code
- Fix the bug
- Add/update tests if needed
- Mark complete

### Feature Requests

- Understand the desired behavior
- Plan the implementation
- Build the feature
- Verify it works
- Mark complete

### Questions

- Understand what's being asked
- Research the answer (code, docs, web)
- Provide the answer
- Mark complete if the question is resolved

### Investigations

- Understand what needs investigating
- Gather evidence (logs, code, data)
- Present findings
- Mark complete with summary

## When NOT to Apply

- When the user is asking about a to-do, not asking you to do it
- When the task requires human judgment or decision-making
- When the task is blocked on external factors
- When you don't have enough context to implement safely

## Recovery

If you can't find the thought:

1. Ask the user for more details
2. Try different search terms
3. Check if it might be in a different format

If you can't implement the task:

1. Explain what's blocking you
2. Ask for clarification
3. Suggest what needs to happen first
