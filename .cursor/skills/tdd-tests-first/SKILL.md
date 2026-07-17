---
name: tdd-tests-first
description: >-
  Test-driven development for Eigen: define the end goal, write failing unit
  tests and headed Playwright e2e tests first, then implement until everything
  is green and nothing else broke. Use when the user asks to do something, plan
  something, build a feature, fix a bug, or change behavior — before writing
  production code.
---

# TDD: tests first, then code until green

This is how we work going forward. Do **not** invent production code before the tests exist.

## Non-negotiable order

1. **Understand the end goal** — state the behavior in plain language (one sentence + in/out of scope). Wait for agreement if the ask was ambiguous or the user is correcting a prior failure.
2. **Write the tests first** (they should fail or assert the contract before the fix exists):
   - **Unit tests** under `src/**/*.spec.ts` (merge gate: `npm run test:unit`).
   - **Headed Playwright e2e** — add/extend coverage in `src/routes/e2e/release.e2e.ts` + helpers (`npm run test:e2e:release:headed`). For a surface-specific e2e, still wire the assertion into the headed release path when the behavior is user-visible.
3. **Only then write production code** — smallest change that makes those tests pass.
4. **Code until green** — run the new/updated unit specs, then full `npm run test:unit`. Fix root causes; do not weaken assertions.
5. **Nothing else broke** — full unit suite must stay green. Do not ship with skipped or loosened tests.

## Forbidden

- Implementing first and “adding tests later.”
- Claiming done with only a manual click-through and no automated tests.
- Loosening, skipping, or rewriting expectations to match broken behavior.
- Running Q&A eval CLI (`npm run eval*`) — operator-owned via `/eval` UI (see `no-run-evals`).
- Using `$effect` for fetches/control flow when an event/`onMount` exists (see `AGENTS.md` / `no-svelte-effect`).

## Shared logic rule (from product direction)

If the same user action appears in multiple UI surfaces (e.g. mark done on Tasks vs Projects vs project detail), **one shared utility** + **one test contract**. Views only group/render; they do not fork the action.

## What to run

After tests are written and while implementing:

```bash
# Focused
npm run test:unit -- path/to/new-or-changed.spec.ts

# Before declaring done
npm run test:unit
```

Headed e2e (operator or when this skill’s e2e step was added and local stack is up):

```bash
npm run test:e2e:release:headed
```

Agent: run unit tests yourself. Point the operator at the headed release task/script when e2e was part of the plan; do not skip writing the headed assertion.

## Done checklist

- [ ] End goal stated (and agreed if needed)
- [ ] Unit tests written **before** production code
- [ ] Headed Playwright coverage written **before** production code (release path or dedicated e2e wired into headed run)
- [ ] Production code uses shared utilities where surfaces share behavior
- [ ] Focused unit specs green
- [ ] Full `npm run test:unit` green
- [ ] Reported what ran and pass/fail to the user

## Related

- Post-implementation unit gate: [run-tests-after-feature](../run-tests-after-feature/SKILL.md)
- Testing map: [`docs/testing/README.md`](../../../docs/testing/README.md)
- Guardrails: [`AGENTS.md`](../../../AGENTS.md)
