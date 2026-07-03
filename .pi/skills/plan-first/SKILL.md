---
name: plan-first
description: Enforces making a structured plan before writing files or making changes. Prevents looping and unstructured debugging by requiring explicit steps.
---

# Plan First

## The Rule

Before writing or editing any file, you MUST:

1. **State the goal** — one sentence, what you're trying to achieve
2. **Make a numbered plan** — list the specific steps you'll take
3. **Read before writing** — read every file you plan to modify BEFORE making changes
4. **Execute the plan** — follow the steps in order, checking off each one
5. **Verify the result** — confirm the change worked

## Anti-Patterns to Avoid

- ❌ **Reading the same file multiple times** — if you've read it, you have the info
- ❌ **Editing before reading** — always read the file first
- ❌ **Making multiple small edits** — batch related changes into one edit call
- ❌ **Repeating the same command** — if it failed once, try a different approach
- ❌ **Jumping to code without understanding** — trace the flow first

## Example Workflow

**Goal:** Fix the billing error where harness users have 0 credits

**Plan:**
1. Read `src/lib/server/billing/usage-gate.ts` to see where credits are checked
2. Read `src/lib/server/capture/capture-enrich-worker.ts` to see the enrich flow
3. Identify where `ensureHarnessWalletCredits` should be called but isn't
4. Make one targeted edit to fix the gap
5. Verify by checking the code reads correctly

**Execute:**
- [x] Step 1: Read usage-gate.ts ✓
- [x] Step 2: Read capture-enrich-worker.ts ✓
- [x] Step 3: Found gap in enrich worker
- [ ] Step 4: Make the edit
- [ ] Step 5: Verify

## When to Apply

- Before any code change
- Before debugging complex issues
- When you feel stuck or tempted to retry the same thing
- When the loop guard might trigger

## Recovery from Loops

If you hit the loop guard:
1. Stop immediately
2. State what you were trying to do
3. List what you already know
4. Propose a new approach
5. Ask the user to reset the loop guard
